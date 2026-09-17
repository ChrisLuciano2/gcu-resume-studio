import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocked below so this test exercises just the tailor route's own validation
// logic (job description length cap) without a real DB/Worker — same
// dependency-mocking shape as an ordinary Next.js route handler test.
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user-1") }));
vi.mock("@/lib/studentContext", () => ({
  getStudentContext: vi.fn(async () => ({ d1: { accountId: "a", databaseId: "d", bearerToken: "t" }, workerUrl: "https://worker.example" })),
}));
vi.mock("@/lib/studentD1", () => ({
  studentD1Query: vi.fn(async () => [{ plan: JSON.stringify({ sections: [{ section: "Experience", chunks: [] }] }) }]),
}));
vi.mock("@/lib/workerClient", () => ({
  tailorChunks: vi.fn(async () => ({ ok: true, plan: [] })),
}));

import { POST } from "@/app/api/drafts/[id]/tailor/route";
import { tailorChunks } from "@/lib/workerClient";
import { MAX_JOB_DESCRIPTION_LENGTH } from "@/lib/jobDescriptionLimit";

function makeRequest(body: unknown) {
  return new Request("https://app.example/api/drafts/draft-1/tailor", {
    method: "POST",
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/drafts/[id]/tailor: jobDescription validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a jobDescription over the length cap with 400, before ever calling the Worker", async () => {
    const req = makeRequest({ targetField: "Nursing", jobDescription: "x".repeat(MAX_JOB_DESCRIPTION_LENGTH + 1) });
    const res = await POST(req, { params: { id: "draft-1" } });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/too long/);
    expect(tailorChunks).not.toHaveBeenCalled();
  });

  it("accepts a jobDescription right at the length cap and passes it through to the Worker call", async () => {
    const jobDescription = "x".repeat(MAX_JOB_DESCRIPTION_LENGTH);
    const req = makeRequest({ targetField: "Nursing", jobDescription });
    const res = await POST(req, { params: { id: "draft-1" } });
    expect(res.status).toBe(200);
    expect(tailorChunks).toHaveBeenCalledWith(expect.any(String), expect.any(Array), "Nursing", jobDescription);
  });

  it("proceeds fine with no jobDescription at all (today's exact existing behavior)", async () => {
    const req = makeRequest({ targetField: "Nursing" });
    const res = await POST(req, { params: { id: "draft-1" } });
    expect(res.status).toBe(200);
    expect(tailorChunks).toHaveBeenCalledWith(expect.any(String), expect.any(Array), "Nursing", undefined);
  });

  it("rejects a non-string jobDescription", async () => {
    const req = makeRequest({ targetField: "Nursing", jobDescription: 12345 });
    const res = await POST(req, { params: { id: "draft-1" } });
    expect(res.status).toBe(400);
    expect(tailorChunks).not.toHaveBeenCalled();
  });
});

describe("POST /api/drafts/[id]/tailor: duplicate chunk ids from the model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renumbers a duplicate id the model splits one input chunk's bullets across, instead of returning it twice", async () => {
    vi.mocked(tailorChunks).mockResolvedValueOnce({
      ok: true,
      plan: [
        { id: "chunk-1", bullets: ["First half"], tags: [] },
        { id: "chunk-1", bullets: ["Second half"], tags: [] },
      ],
    });
    const { studentD1Query } = await import("@/lib/studentD1");
    vi.mocked(studentD1Query).mockResolvedValueOnce([
      {
        plan: JSON.stringify({
          sections: [{ section: "Experience", chunks: [{ id: "chunk-1", bullets: ["Original"], tags: [] }] }],
        }),
      },
    ]);

    const req = makeRequest({ targetField: "Nursing" });
    const res = await POST(req, { params: { id: "draft-1" } });
    const body = await res.json();

    expect(res.status).toBe(200);
    const allChunks = body.proposedPlan.sections.flatMap((s: { chunks: Array<{ id: string }> }) => s.chunks);
    const ids = allChunks.map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("chunk-1");
    expect(ids).toContain("chunk-1-split1");
    // Still resolved to the original chunk's section, not dropped into "General".
    expect(body.proposedPlan.sections).toHaveLength(1);
    expect(body.proposedPlan.sections[0].section).toBe("Experience");
  });
});
