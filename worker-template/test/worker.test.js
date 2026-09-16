import { describe, expect, it, vi, beforeEach } from "vitest";
import worker, { cosineSimilarity, extractChunkIds, safeParseJsonArray, todayUtc, withTimeout } from "../src/index.js";

describe("pure helpers", () => {
  it("cosineSimilarity: identical vectors score 1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("cosineSimilarity: orthogonal vectors score 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("cosineSimilarity: mismatched lengths are rejected, not thrown", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(-1);
  });

  it("extractChunkIds: reads a flat plan array", () => {
    expect(extractChunkIds([{ id: "a" }, { id: "b" }])).toEqual(["a", "b"]);
  });

  it("extractChunkIds: reads a sectioned plan object", () => {
    const plan = { sections: [{ chunks: [{ id: "a" }, { id: "b" }] }, { chunks: [{ id: "c" }] }] };
    expect(extractChunkIds(plan)).toEqual(["a", "b", "c"]);
  });

  it("extractChunkIds: never throws on garbage input", () => {
    expect(extractChunkIds(null)).toEqual([]);
    expect(extractChunkIds(undefined)).toEqual([]);
    expect(extractChunkIds("not a plan")).toEqual([]);
  });

  it("safeParseJsonArray: parses a fenced JSON array", () => {
    const text = "```json\n[{\"id\":\"1\"}]\n```";
    expect(safeParseJsonArray(text)).toEqual([{ id: "1" }]);
  });

  it("safeParseJsonArray: returns null for non-JSON / non-array AI output", () => {
    expect(safeParseJsonArray("sorry, I can't do that")).toBeNull();
    expect(safeParseJsonArray('{"not":"an array"}')).toBeNull();
  });

  it("safeParseJsonArray: unwraps { plan: [...] } — the actual shape JSON Mode returns as a string", () => {
    // Confirmed live: this is not a hypothetical shape — Workers AI's response_
    // format: json_schema sometimes returns .response as this exact string
    // instead of an already-parsed object, and the schema wraps the array in
    // `plan`, not a bare array. The earlier version of this function only
    // accepted a bare array and silently failed on every one of these.
    const text = '{"plan": [{"id": "1", "bullets": ["x"], "tags": []}]}';
    expect(safeParseJsonArray(text)).toEqual([{ id: "1", bullets: ["x"], tags: [] }]);
  });

  it("safeParseJsonArray: truncated/incomplete JSON (a real symptom of output-length truncation) still returns null, not a partial parse", () => {
    const truncated = '{"plan": [{"id": "1", "bullets": ["Led triage"], "tags": ["nursing"';
    expect(safeParseJsonArray(truncated)).toBeNull();
  });

  it("todayUtc: returns a YYYY-MM-DD string", () => {
    expect(todayUtc()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("withTimeout: resolves the promise when it beats the clock", async () => {
    const result = await withTimeout(Promise.resolve("fast"), 100);
    expect(result).toBe("fast");
  });

  it("withTimeout: resolves to null instead of hanging when the promise is slow", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("too late"), 500));
    const result = await withTimeout(slow, 20);
    expect(result).toBeNull();
  });
});

describe("/chat rate limiting and caching (mocked AI/KV/D1)", () => {
  let kvStore;
  let cachedAnswers;
  let env;

  beforeEach(() => {
    kvStore = new Map();
    cachedAnswers = new Map();
    env = {
      DAILY_CHAT_BUDGET: "2",
      AI: {
        run: vi.fn(async (model) => {
          if (model.includes("bge")) return { data: [[1, 0, 0]] };
          return { response: "grounded answer" };
        }),
      },
      CHAT_KV: {
        get: vi.fn(async (key) => kvStore.get(key) ?? null),
        put: vi.fn(async (key, value) => {
          kvStore.set(key, value);
        }),
      },
      // Fake D1 binding — mirrors the real prepare().bind().first()/.all()/.run()
      // shape (https://developers.cloudflare.com/d1/best-practices/local-development/#isolate-storage-per-test-file)
      // closely enough for these tests without needing a real database.
      DB: {
        prepare: vi.fn((sql) => makeFakeStatement(sql, { cachedAnswers })),
      },
    };
  });

  function makeFakeStatement(sql, { cachedAnswers }) {
    let boundArgs = [];
    const statement = {
      bind: (...args) => {
        boundArgs = args;
        return statement;
      },
      first: async () => {
        if (sql.includes("FROM drafts WHERE slug")) {
          return boundArgs[0] === "jane-nursing" ? { id: "draft-1", slug: "jane-nursing" } : null;
        }
        if (sql.includes("SELECT plan FROM drafts")) {
          return boundArgs[0] === "draft-1" ? { plan: JSON.stringify([{ id: "chunk-1" }]) } : null;
        }
        if (sql.includes("FROM chat_cache")) {
          const [draftId, questionHash] = boundArgs;
          return cachedAnswers.has(`${draftId}:${questionHash}`) ? { answer: cachedAnswers.get(`${draftId}:${questionHash}`) } : null;
        }
        throw new Error(`unexpected D1 .first() for: ${sql}`);
      },
      all: async () => {
        if (sql.includes("FROM resume_chunks")) {
          const results = boundArgs.includes("chunk-1")
            ? [{ id: "chunk-1", section: "Experience", heading: "RN, Mercy Hospital", bullets: JSON.stringify(["Led triage"]), embedding: JSON.stringify([1, 0, 0]) }]
            : [];
          return { results };
        }
        throw new Error(`unexpected D1 .all() for: ${sql}`);
      },
      run: async () => {
        if (sql.includes("INSERT INTO chat_cache")) {
          const [draftId, questionHash, answer] = boundArgs;
          cachedAnswers.set(`${draftId}:${questionHash}`, answer);
          return { success: true };
        }
        throw new Error(`unexpected D1 .run() for: ${sql}`);
      },
    };
    return statement;
  }

  async function chat(question, slug = "jane-nursing") {
    const req = new Request("https://worker.example/chat", {
      method: "POST",
      body: JSON.stringify({ slug, question }),
    });
    return worker.fetch(req, env);
  }

  it("answers a fresh question and increments today's counter", async () => {
    const res = await chat("What EHR systems has she used?");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.answer).toBe("grounded answer");
    expect(kvStore.get(`rl:jane-nursing:${todayUtc()}`)).toBe("1");
  });

  it("returns 429 once the per-draft daily budget is exhausted", async () => {
    await chat("q1");
    await chat("q2");
    const res = await chat("q3");
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.reason).toBe("rate_limited");
  });

  it("never leaks another draft's chunks into retrieval", async () => {
    // resume_chunks is fetched filtered by this draft's own chunk ids extracted
    // from its locked plan — assert the filter was actually applied, not a bare
    // "all chunks" query.
    await chat("anything");
    const chunkPrepareCall = env.DB.prepare.mock.calls.find(([sql]) => sql.includes("FROM resume_chunks"));
    expect(chunkPrepareCall[0]).toContain("WHERE id IN");
  });
});

describe("/tailor: job-description-based tailoring", () => {
  const chunks = [{ id: "1", section: "Experience", bullets: ["Did a thing"], tags: [] }];

  function makeEnv() {
    return {
      AI: { run: vi.fn(async () => ({ response: { plan: [{ id: "1", bullets: ["Did a thing"], tags: [] }] } })) },
    };
  }

  async function tailorWith(body) {
    const req = new Request("https://worker.example/tailor", {
      method: "POST",
      body: JSON.stringify({ chunks, targetField: "Nursing", ...body }),
    });
    return worker.fetch(req, makeEnv());
  }

  it("includes the job description text in the prompt sent to the model when provided", async () => {
    const env = makeEnv();
    const req = new Request("https://worker.example/tailor", {
      method: "POST",
      body: JSON.stringify({ chunks, targetField: "Nursing", jobDescription: "Seeking a pediatric ICU nurse with Epic experience." }),
    });
    await worker.fetch(req, env);
    const systemPrompt = env.AI.run.mock.calls[0][1].messages[0].content;
    expect(systemPrompt).toContain("Seeking a pediatric ICU nurse with Epic experience.");
    expect(systemPrompt).toContain("REFERENCE MATERIAL ONLY");
  });

  it("omits any job-posting framing from the prompt when jobDescription is absent", async () => {
    const env = makeEnv();
    const req = new Request("https://worker.example/tailor", {
      method: "POST",
      body: JSON.stringify({ chunks, targetField: "Nursing" }),
    });
    await worker.fetch(req, env);
    const systemPrompt = env.AI.run.mock.calls[0][1].messages[0].content;
    expect(systemPrompt).not.toContain("REFERENCE MATERIAL ONLY");
    expect(systemPrompt).not.toContain("Job posting");
  });

  it("rejects a jobDescription over the length cap with 400", async () => {
    const res = await tailorWith({ jobDescription: "x".repeat(6001) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too long/);
  });
});

describe("/cover-letter", () => {
  const chunks = [{ heading: "RN, Mercy Hospital", bullets: ["Led triage"], tags: [] }];

  function makeEnv(response = "Dear Hiring Manager, ...") {
    return { AI: { run: vi.fn(async () => ({ response })) } };
  }

  async function coverLetterWith(body, env = makeEnv()) {
    const req = new Request("https://worker.example/cover-letter", {
      method: "POST",
      body: JSON.stringify({ chunks, ...body }),
    });
    return { res: await worker.fetch(req, env), env };
  }

  it("returns the generated letter as plain text, no JSON Mode", async () => {
    const { res } = await coverLetterWith({ header: "Jane Doe", targetField: "Nursing" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.letter).toBe("Dear Hiring Manager, ...");
  });

  it("includes the candidate's name from header in the prompt when provided", async () => {
    const { env } = await coverLetterWith({ header: "Jane Doe, jane@example.com" });
    const systemPrompt = env.AI.run.mock.calls[0][1].messages[0].content;
    expect(systemPrompt).toContain("Jane Doe, jane@example.com");
  });

  it("works with no targetField at all — a cover letter can stay generic", async () => {
    const { res, env } = await coverLetterWith({});
    expect(res.status).toBe(200);
    const systemPrompt = env.AI.run.mock.calls[0][1].messages[0].content;
    expect(systemPrompt).toContain("No specific target field was given");
  });

  it("includes the job posting as reference material, not instructions, when provided", async () => {
    const { env } = await coverLetterWith({ jobDescription: "Seeking a pediatric ICU nurse with Epic experience." });
    const systemPrompt = env.AI.run.mock.calls[0][1].messages[0].content;
    expect(systemPrompt).toContain("Seeking a pediatric ICU nurse with Epic experience.");
    expect(systemPrompt).toContain("REFERENCE MATERIAL ONLY");
  });

  it("omits job-posting framing when jobDescription is absent", async () => {
    const { env } = await coverLetterWith({});
    const systemPrompt = env.AI.run.mock.calls[0][1].messages[0].content;
    expect(systemPrompt).not.toContain("REFERENCE MATERIAL ONLY");
  });

  it("rejects a jobDescription over the length cap with 400", async () => {
    const { res } = await coverLetterWith({ jobDescription: "x".repeat(6001) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too long/);
  });

  it("retries once on timeout before giving up, same reasoning as /tailor", async () => {
    vi.useFakeTimers();
    try {
      let call = 0;
      const env = {
        AI: {
          run: vi.fn(() => {
            call += 1;
            if (call < 2) return new Promise(() => {}); // never resolves — withTimeout's own timer wins
            return Promise.resolve({ response: "Dear Hiring Manager, ..." });
          }),
        },
      };
      const resultPromise = coverLetterWith({}, env);
      await vi.advanceTimersByTimeAsync(30_000); // first attempt's COVER_LETTER_TIMEOUT_MS elapses
      const { res } = await resultPromise;
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(env.AI.run).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up with reason timeout if every attempt times out", async () => {
    vi.useFakeTimers();
    try {
      const env = { AI: { run: vi.fn(() => new Promise(() => {})) } };
      const resultPromise = coverLetterWith({}, env);
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(30_000);
      const { res } = await resultPromise;
      const body = await res.json();
      expect(res.status).toBe(504);
      expect(body.ok).toBe(false);
      expect(body.reason).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("/tailor: retries a non-deterministic bad JSON response or a timeout instead of giving up immediately", () => {
  const chunks = [{ id: "1", section: "Experience", bullets: ["Did a thing"], tags: [] }];
  // MAX_ATTEMPTS is 2 (see src/index.js) — bounding worst-case latency at ~2x
  // TAILOR_TIMEOUT_MS rather than 3x, since each attempt can now run up to 40s.

  async function tailor(env) {
    const req = new Request("https://worker.example/tailor", {
      method: "POST",
      body: JSON.stringify({ chunks, targetField: "Nursing" }),
    });
    return worker.fetch(req, env);
  }

  it("succeeds if the 2nd attempt returns valid JSON Mode output after the 1st fails to parse", async () => {
    let call = 0;
    const env = {
      AI: {
        run: vi.fn(async () => {
          call += 1;
          // Confirmed live: JSON Mode occasionally returns something that fails
          // our validation even under a schema — this mocks that non-determinism
          // rather than assuming every call succeeds or fails identically.
          if (call < 2) return { response: "sorry, I can't help with that" };
          return { response: { plan: [{ id: "1", bullets: ["Did a thing, emphasized for nursing"], tags: [] }] } };
        }),
      },
    };
    const res = await tailor(env);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.plan[0].id).toBe("1");
    expect(env.AI.run).toHaveBeenCalledTimes(2);
  });

  it("succeeds if the 2nd attempt returns valid output after the 1st times out", async () => {
    // Confirmed live: the exact same request timed out once (>40s) and
    // succeeded in ~8s on a retry — a timeout here is transient tail latency,
    // not a doomed request, so it must be retried the same as a bad-JSON
    // response, not returned as an immediate failure. Fake timers so this
    // doesn't actually burn 40 real seconds per test run.
    vi.useFakeTimers();
    try {
      let call = 0;
      const env = {
        AI: {
          run: vi.fn(() => {
            call += 1;
            if (call < 2) return new Promise(() => {}); // never resolves — withTimeout's own timer wins
            return Promise.resolve({ response: { plan: [{ id: "1", bullets: ["Did a thing"], tags: [] }] } });
          }),
        },
      };
      const resPromise = tailor(env);
      await vi.advanceTimersByTimeAsync(40_000); // first attempt's TAILOR_TIMEOUT_MS elapses
      const res = await resPromise;
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(env.AI.run).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up with reason unparseable_ai_response only after exhausting all attempts", async () => {
    const env = {
      AI: { run: vi.fn(async () => ({ response: "still not JSON" })) },
    };
    const res = await tailor(env);
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("unparseable_ai_response");
    expect(env.AI.run.mock.calls.length).toBeGreaterThan(1);
  });

  it("gives up with reason timeout if every attempt times out", async () => {
    vi.useFakeTimers();
    try {
      const env = {
        AI: { run: vi.fn(() => new Promise(() => {})) },
      };
      const resPromise = tailor(env);
      await vi.advanceTimersByTimeAsync(40_000); // attempt 1
      await vi.advanceTimersByTimeAsync(40_000); // attempt 2
      const res = await resPromise;
      const body = await res.json();
      expect(res.status).toBe(504);
      expect(body.ok).toBe(false);
      expect(body.reason).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});
