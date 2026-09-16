import { describe, expect, it, vi, beforeEach } from "vitest";

// Same dependency-mocking shape as tests/tailorRoute.test.ts.
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user-1") }));
vi.mock("@/lib/studentContext", () => ({
  getStudentContext: vi.fn(async () => ({ d1: { accountId: "a", databaseId: "d", bearerToken: "t" }, workerUrl: "https://worker.example" })),
}));
vi.mock("@/lib/studentD1", () => ({
  studentD1Query: vi.fn(async (_d1: unknown, sql: string) => {
    if (sql.includes("SELECT plan, category, niche")) {
      return [{ plan: JSON.stringify({ sections: [{ section: "Experience", chunks: [] }], header: "Jane Doe" }), category: "Nursing", niche: "Pediatric Nursing" }];
    }
    return [{ cover_letter: "saved letter" }];
  }),
}));
vi.mock("@/lib/workerClient", () => ({
  generateCoverLetter: vi.fn(async () => ({ ok: true, letter: "Dear Hiring Manager, ..." })),
}));

import { POST, PATCH } from "@/app/api/drafts/[id]/cover-letter/route";
import { generateCoverLetter } from "@/lib/workerClient";
import { studentD1Query } from "@/lib/studentD1";
import { MAX_JOB_DESCRIPTION_LENGTH } from "@/lib/jobDescriptionLimit";

function makeRequest(method: string, body: unknown) {
  return new Request("https://app.example/api/drafts/draft-1/cover-letter", {
    method,
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/drafts/[id]/cover-letter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the draft's niche/category as targetField and passes the resume's header through", async () => {
    const req = makeRequest("POST", {});
    const res = await POST(req, { params: { id: "draft-1" } });
    expect(res.status).toBe(200);
    expect(generateCoverLetter).toHaveBeenCalledWith(
      "https://worker.example",
      expect.any(Array),
      "Jane Doe",
      "Pediatric Nursing",
      undefined,
    );
  });

  it("rejects a jobDescription over the length cap with 400, before ever calling the Worker", async () => {
    const req = makeRequest("POST", { jobDescription: "x".repeat(MAX_JOB_DESCRIPTION_LENGTH + 1) });
    const res = await POST(req, { params: { id: "draft-1" } });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/too long/);
    expect(generateCoverLetter).not.toHaveBeenCalled();
  });

  it("does not persist anything — same propose-don't-commit principle as /tailor", async () => {
    const req = makeRequest("POST", {});
    await POST(req, { params: { id: "draft-1" } });
    const writeCalls = (studentD1Query as ReturnType<typeof vi.fn>).mock.calls.filter(([, sql]) => String(sql).startsWith("UPDATE"));
    expect(writeCalls).toHaveLength(0);
  });
});

describe("PATCH /api/drafts/[id]/cover-letter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the (possibly hand-edited) letter", async () => {
    const req = makeRequest("PATCH", { letter: "My hand-edited letter" });
    const res = await PATCH(req, { params: { id: "draft-1" } });
    expect(res.status).toBe(200);
    const updateCall = (studentD1Query as ReturnType<typeof vi.fn>).mock.calls.find(([, sql]) => String(sql).startsWith("UPDATE"));
    expect(updateCall![2]).toEqual(["My hand-edited letter", expect.any(String), "draft-1"]);
  });

  it("rejects a non-string letter", async () => {
    const req = makeRequest("PATCH", { letter: 12345 });
    const res = await PATCH(req, { params: { id: "draft-1" } });
    expect(res.status).toBe(400);
  });
});
