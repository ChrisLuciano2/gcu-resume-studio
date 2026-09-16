// Cloudflare Worker deployed into each student's own account by the orchestrator
// (apps/web/lib/cloudflare.ts's deployWorker). Plain ES module JS on purpose — the
// orchestrator uploads this file's source directly with no build step, so keep it
// dependency-free. Bindings (see PLAN.md): AI, CHAT_KV, SUPABASE_URL (plain_text),
// SUPABASE_SERVICE_KEY (secret_text), DAILY_CHAT_BUDGET (plain_text).

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
// Confirmed live on developers.cloudflare.com/workers-ai/models/ as of 2026-09-16.
// llama-3.1-8b-instruct (the original placeholder) is gone entirely from the
// catalog — re-check this page before assuming the pin below is still current if
// much time has passed; the catalog churns. 70B-fp8-fast over a smaller Llama
// variant because both /tailor (must preserve facts exactly while reordering) and
// /chat (must stay grounded in only the retrieved chunks) need reliable
// instruction-following more than they need raw speed.
const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const AI_TIMEOUT_MS = 20_000;
// /tailor generates a full structured rewrite (max_tokens: 2048, up to
// MAX_ATTEMPTS retries) — confirmed live that AI_TIMEOUT_MS's 20s, sized for the
// embedding/chat calls, was too tight once max_tokens went up to fix truncation
// and cut a single attempt off mid-generation. Give this call its own budget.
const TAILOR_TIMEOUT_MS = 40_000;

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
  ].join(" ");

  // Confirmed live 2026-09-16: prompting for "respond ONLY with JSON, no prose"
  // was not reliable — the model sometimes wrapped the array in explanatory text
  // that our string parser couldn't recover, failing the whole rewrite. Workers AI
  // JSON Mode (response_format: json_schema) makes the platform itself enforce
  // the shape instead of hoping the model follows an instruction, and is listed as
  // supported for this model at developers.cloudflare.com/workers-ai/json-mode/.
  //
  // Also confirmed live: JSON Mode still isn't 100% reliable even so — the exact
  // same request that failed with an unparseable response on one call succeeded
  // cleanly on a retry immediately after. This is sampling variance, not a
  // systematic prompt/schema bug, so the right fix is a bounded retry, not more
  // prompt engineering chasing a non-deterministic failure.
  const responseFormat = {
    type: "json_schema",
    json_schema: {
      type: "object",
      properties: {
        plan: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              bullets: { type: "array", items: { type: "string" } },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["id", "bullets", "tags"],
          },
        },
      },
      required: ["plan"],
    },
  };

  // Confirmed live 2026-09-16: this model's latency for a 5-chunk resume is
  // usually 8-11s but occasionally exceeds 40s on the same request — a timeout is
  // transient tail latency, not a sign the request is doomed, so it gets retried
  // exactly like a malformed-JSON response rather than failing immediately. Only
  // 2 attempts (not 3) to keep the worst case — two slow attempts back to back —
  // bounded at roughly 2x TAILOR_TIMEOUT_MS instead of 3x.
  const MAX_ATTEMPTS = 2;
  let lastReason = "timeout";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const aiResult = await withTimeout(
      env.AI.run(TEXT_MODEL, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(chunks) },
        ],
        response_format: responseFormat,
        // Confirmed live 2026-09-16: the actual failure mode behind
        // "unparseable_ai_response" wasn't the model ignoring the schema — it was
        // the platform's default max_tokens truncating the output mid-JSON on a
        // 5-chunk resume (debugRaw showed a syntactically-cut-off string missing
        // its closing brackets). A full resume has more chunks than that, so this
        // isn't an edge case to special-case around — it's the normal-size input.
        // 2048 (not 4096) deliberately — the actual successful outputs observed
        // were only a few hundred tokens; latency scales with payload/output size
        // (confirmed live: 1.2s for one chunk vs. 8-40s+ for five), so the ceiling
        // should be generously above real usage, not maximized for its own sake.
        max_tokens: 2048,
      }),
      TAILOR_TIMEOUT_MS,
    );

    if (!aiResult) {
      lastReason = "timeout";
      continue;
    }

    // JSON Mode's docs example shows .response as an already-parsed object, but
    // confirmed live: it sometimes comes back as a raw string instead (with this
    // model, at least) — the safeParseJsonArray fallback isn't hypothetical
    // future-proofing, it's load-bearing today.
    const raw = aiResult.response;
    const plan = typeof raw === "string" ? safeParseJsonArray(raw) : Array.isArray(raw?.plan) ? raw.plan : null;
    if (plan) return json({ ok: true, plan });
    lastReason = "unparseable_ai_response";
  }

  return json({ ok: false, reason: lastReason }, lastReason === "timeout" ? 504 : 502);
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
    if (Array.isArray(parsed)) return parsed;
    // Confirmed live: our JSON Mode schema wraps the array in { plan: [...] },
    // and when this fallback's caller (a raw string from .response) actually
    // needs it, it's this wrapped shape, not a bare array — unwrap it rather
    // than only handling the shape the caller doesn't actually produce.
    if (parsed && Array.isArray(parsed.plan)) return parsed.plan;
    return null;
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
