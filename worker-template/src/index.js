// Cloudflare Worker deployed into each student's own account by the orchestrator
// (apps/web/lib/cloudflare.ts's deployWorker). Plain ES module JS on purpose — the
// orchestrator uploads this file's source directly with no build step, so keep it
// dependency-free. Bindings (see PLAN.md): AI, CHAT_KV, SUPABASE_URL (plain_text),
// SUPABASE_SERVICE_KEY (secret_text), DAILY_CHAT_BUDGET (plain_text).

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
// Verify against developers.cloudflare.com/workers-ai/models/ before shipping —
// the catalog had a deprecation wave in May 2026, so pin whatever the live
// instruction-tuned Llama-3.1-8B-class model id is at deploy time.
const TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const AI_TIMEOUT_MS = 20_000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/embed") return await handleEmbed(request, env);
      if (request.method === "POST" && url.pathname === "/tailor") return await handleTailor(request, env);
      if (request.method === "POST" && url.pathname === "/chat") return await handleChat(request, env);
      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "internal error" }, 500);
    }
  },
};

async function handleEmbed(request, env) {
  const { texts } = await request.json();
  if (!Array.isArray(texts) || texts.length === 0) return json({ error: "texts[] is required" }, 400);

  const result = await withTimeout(env.AI.run(EMBEDDING_MODEL, { text: texts }), AI_TIMEOUT_MS);
  if (!result) return json({ ok: false, reason: "timeout" }, 504);

  return json({ ok: true, embeddings: result.data });
}

/**
 * Rewrites resume chunks for a target field. Never invents or drops facts — only
 * reorders/re-emphasizes. Times out cleanly so the editor's generating state
 * always resolves instead of hanging.
 */
async function handleTailor(request, env) {
  const { chunks, targetField } = await request.json();
  if (!Array.isArray(chunks) || !targetField) {
    return json({ error: "chunks[] and targetField are required" }, 400);
  }

  const systemPrompt = [
    "You are a resume tailoring assistant.",
    "You are given a JSON array of resume chunks, each with a stable `id`.",
    `You are tailoring this resume for the field: "${targetField}".`,
    "You may reorder chunks and rewrite bullet phrasing to re-emphasize what matters for that field.",
    "You must NEVER invent facts, numbers, employers, dates, or skills that are not already present in the input.",
    "You must NEVER drop a chunk's underlying facts, only re-present them.",
    "Respond ONLY with JSON: an array of { id, bullets, tags } in the new order. No prose, no markdown fences.",
  ].join(" ");

  const aiResult = await withTimeout(
    env.AI.run(TEXT_MODEL, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(chunks) },
      ],
    }),
    AI_TIMEOUT_MS,
  );

  if (!aiResult) return json({ ok: false, reason: "timeout" }, 504);

  const parsed = safeParseJsonArray(aiResult.response);
  if (!parsed) return json({ ok: false, reason: "unparseable_ai_response" }, 502);

  return json({ ok: true, plan: parsed });
}

/**
 * Public, per-draft RAG chatbot. Retrieval is scoped to exactly the draft's own
 * chunks (via resume_id -> draft's locked plan chunk ids) so one draft's chatbot
 * can never leak another draft's or another student's content. Rate-limited and
 * cached per draft via KV to stretch the Workers AI free-tier daily budget.
 */
async function handleChat(request, env) {
  const { slug, question } = await request.json();
  if (!slug || !question) return json({ error: "slug and question are required" }, 400);

  const draft = await fetchDraftBySlug(env, slug);
  if (!draft) return json({ error: "not found" }, 404);

  const budget = Number(env.DAILY_CHAT_BUDGET || "20");
  const rateLimitKey = `rl:${slug}:${todayUtc()}`;
  const countRaw = await env.CHAT_KV.get(rateLimitKey);
  const count = countRaw ? Number(countRaw) : 0;
  if (count >= budget) {
    return json(
      { ok: false, reason: "rate_limited", message: "This resume's chatbot has answered its questions for today — come back tomorrow." },
      429,
    );
  }

  const questionHash = await sha256Hex(question.trim().toLowerCase());
  const cached = await fetchCachedAnswer(env, draft.id, questionHash);
  if (cached) return json({ ok: true, answer: cached, cached: true });

  const queryEmbedding = await withTimeout(env.AI.run(EMBEDDING_MODEL, { text: [question] }), AI_TIMEOUT_MS);
  if (!queryEmbedding) return json({ ok: false, reason: "timeout" }, 504);

  const topChunks = await vectorSearchChunks(env, draft.id, queryEmbedding.data[0]);

  const systemPrompt = [
    "You are a resume assistant answering a recruiter's question about ONE candidate's tailored resume.",
    "Answer ONLY using the resume excerpts provided below. If the answer isn't in them, say you don't have that information.",
    "Never speculate or invent qualifications.",
    "--- Resume excerpts ---",
    topChunks.map((c) => `${c.heading ?? c.section}: ${(c.bullets || []).join(" ")}`).join("\n"),
  ].join("\n");

  const aiResult = await withTimeout(
    env.AI.run(TEXT_MODEL, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
    }),
    AI_TIMEOUT_MS,
  );
  if (!aiResult) return json({ ok: false, reason: "timeout" }, 504);

  const answer = aiResult.response;
  await Promise.all([
    env.CHAT_KV.put(rateLimitKey, String(count + 1), { expirationTtl: 60 * 60 * 26 }),
    cacheAnswer(env, draft.id, questionHash, answer),
  ]);

  return json({ ok: true, answer, cached: false });
}

// --- Supabase access (direct REST via the bound service-role key) ---

async function supabaseRest(env, path, init) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init && init.headers),
    },
  });
  if (!res.ok) throw new Error(`Supabase REST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchDraftBySlug(env, slug) {
  const rows = await supabaseRest(env, `drafts?slug=eq.${encodeURIComponent(slug)}&select=id,slug`);
  return rows[0] ?? null;
}

async function vectorSearchChunks(env, draftId, embedding, limit = 6) {
  // Scoped strictly to this draft's own chunk ids (drawn from its locked plan),
  // never a bare "top chunks in the project" query — that's what would leak
  // another draft's content into this one's chatbot.
  const draftRows = await supabaseRest(env, `drafts?id=eq.${draftId}&select=plan`);
  const plan = draftRows[0]?.plan;
  const chunkIds = extractChunkIds(plan);
  if (chunkIds.length === 0) return [];

  const idsFilter = `(${chunkIds.map((id) => `"${id}"`).join(",")})`;
  // pgvector cosine-distance ordering via PostgREST's rpc is cleaner, but a plain
  // select + in-memory rank keeps this endpoint dependency-free for the template.
  const rows = await supabaseRest(
    env,
    `resume_chunks?id=in.${idsFilter}&select=id,section,heading,bullets,embedding`,
  );
  return rows
    .map((r) => ({ ...r, score: cosineSimilarity(r.embedding, embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function extractChunkIds(plan) {
  if (!plan) return [];
  if (Array.isArray(plan)) return plan.map((c) => c.id).filter(Boolean);
  if (Array.isArray(plan.sections)) {
    return plan.sections.flatMap((s) => (s.chunks || []).map((c) => c.id)).filter(Boolean);
  }
  return [];
}

async function fetchCachedAnswer(env, draftId, questionHash) {
  const rows = await supabaseRest(
    env,
    `chat_cache?draft_id=eq.${draftId}&question_hash=eq.${questionHash}&select=answer`,
  );
  return rows[0]?.answer ?? null;
}

async function cacheAnswer(env, draftId, questionHash, answer) {
  await supabaseRest(env, "chat_cache", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ draft_id: draftId, question_hash: questionHash, answer }),
  });
}

// --- helpers ---

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function safeParseJsonArray(text) {
  try {
    const trimmed = text.trim().replace(/^```(json)?/, "").replace(/```$/, "");
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export {
  cosineSimilarity,
  extractChunkIds,
  safeParseJsonArray,
  sha256Hex,
  todayUtc,
  withTimeout,
};
