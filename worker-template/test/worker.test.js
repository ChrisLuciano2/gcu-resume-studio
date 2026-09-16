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

describe("/chat rate limiting and caching (mocked AI/KV/Supabase)", () => {
  const SUPABASE_URL = "https://fake-project.supabase.co";
  let kvStore;
  let env;

  beforeEach(() => {
    kvStore = new Map();
    env = {
      SUPABASE_URL,
      SUPABASE_SERVICE_KEY: "fake-service-key",
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
    };

    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.includes("/rest/v1/drafts?slug=eq.")) {
        return jsonResponse([{ id: "draft-1", slug: "jane-nursing" }]);
      }
      if (u.includes("/rest/v1/drafts?id=eq.")) {
        return jsonResponse([{ plan: [{ id: "chunk-1" }] }]);
      }
      if (u.includes("/rest/v1/resume_chunks")) {
        return jsonResponse([
          { id: "chunk-1", section: "Experience", heading: "RN, Mercy Hospital", bullets: ["Led triage"], embedding: [1, 0, 0] },
        ]);
      }
      if (u.includes("/rest/v1/chat_cache") && (!init || init.method !== "POST")) {
        return jsonResponse([]);
      }
      if (u.includes("/rest/v1/chat_cache") && init?.method === "POST") {
        return jsonResponse({});
      }
      throw new Error(`unexpected fetch to ${u}`);
    });
  });

  function jsonResponse(body) {
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
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
    const chunkCall = global.fetch.mock.calls.find(([url]) => String(url).includes("/resume_chunks"));
    expect(chunkCall[0]).toContain("id=in.");
    expect(chunkCall[0]).toContain("chunk-1");
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
