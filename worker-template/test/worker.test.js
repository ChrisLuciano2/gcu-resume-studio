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
