import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createD1Database, d1Query } from "@/lib/cloudflare";
import { studentD1Query } from "@/lib/studentD1";

// Shapes confirmed live against the real Cloudflare D1 API on 2026-09-16 (see
// the approved migration plan's step 2) — these mocks mirror exactly what
// came back, not a guess: create returns { result: { uuid, ... } }, a
// successful query returns { result: [{ results: [...] }] }, and a failed
// one returns { success: false, errors: [{ code, message }] } at HTTP 400.
describe("cloudflare.ts D1 functions", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("createD1Database posts the name and returns the created database's uuid", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, { success: true, result: { uuid: "db-123", name: "resume-studio-abc" } }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await createD1Database("token", "acct-1", "resume-studio-abc");
    expect(result.uuid).toBe("db-123");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/accounts/acct-1/d1/database");
    expect(JSON.parse(init!.body as string)).toEqual({ name: "resume-studio-abc" });
  });

  it("d1Query sends sql + params and returns just the results array", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, { success: true, result: [{ results: [{ id: "1", val: "hello" }], success: true }] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const rows = await d1Query("token", "acct-1", "db-123", "SELECT * FROM smoke WHERE id = ?", ["1"]);
    expect(rows).toEqual([{ id: "1", val: "hello" }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.cloudflare.com/client/v4/accounts/acct-1/d1/database/db-123/query");
    expect(JSON.parse(init!.body as string)).toEqual({ sql: "SELECT * FROM smoke WHERE id = ?", params: ["1"] });
  });

  it("d1Query returns an empty array rather than throwing when a statement matched no rows", async () => {
    global.fetch = vi.fn(async () => jsonResponse(200, { success: true, result: [{ results: [], success: true }] })) as unknown as typeof fetch;
    expect(await d1Query("token", "acct-1", "db-123", "SELECT * FROM smoke WHERE id = ?", ["missing"])).toEqual([]);
  });

  it("d1Query throws with the provider's error detail on a bad statement", async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(400, { success: false, errors: [{ code: 7500, message: "no such table: nope: SQLITE_ERROR" }], result: [] }),
    ) as unknown as typeof fetch;

    await expect(d1Query("token", "acct-1", "db-123", "SELECT * FROM nope")).rejects.toThrow(/no such table/);
  });
});

describe("studentD1Query: thin wrapper over cloudflare.d1Query", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  beforeEach(() => {
    global.fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, { success: true, result: [{ results: [{ ok: 1 }], success: true }] }),
    ) as unknown as typeof fetch;
  });

  it("routes the client's accountId/databaseId/bearerToken into the request URL and auth header", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;
    const rows = await studentD1Query({ accountId: "acct-x", databaseId: "db-y", bearerToken: "tok-z" }, "SELECT 1");
    expect(rows).toEqual([{ ok: 1 }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/accounts/acct-x/d1/database/db-y/query");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer tok-z");
  });
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
