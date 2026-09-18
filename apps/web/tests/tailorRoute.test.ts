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

describe("POST /api/drafts/[id]/tailor: heading/meta restoration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores the original chunk's heading/meta, since the model's response schema never returns them", async () => {
    vi.mocked(tailorChunks).mockResolvedValueOnce({
      ok: true,
      plan: [{ id: "chunk-1", bullets: ["Rewritten bullet"], tags: ["new-tag"] }],
    });
    const { studentD1Query } = await import("@/lib/studentD1");
    vi.mocked(studentD1Query).mockResolvedValueOnce([
      {
        plan: JSON.stringify({
          sections: [
            {
              section: "Experience",
              chunks: [
                {
                  id: "chunk-1",
                  heading: "Retail Shift Supervisor, Sunrise Outfitters",
                  meta: "Jun 2024 - Present",
                  bullets: ["Original bullet"],
                  tags: ["old-tag"],
                },
              ],
            },
          ],
        }),
      },
    ]);

    const req = makeRequest({ targetField: "Nursing" });
    const res = await POST(req, { params: { id: "draft-1" } });
    const body = await res.json();

    expect(res.status).toBe(200);
    const chunk = body.proposedPlan.sections[0].chunks[0];
    expect(chunk.heading).toBe("Retail Shift Supervisor, Sunrise Outfitters");
    expect(chunk.meta).toBe("Jun 2024 - Present");
    // The model's actual rewrite still applies — this isn't reverting content,
    // just restoring the fields the model was never asked for.
    expect(chunk.bullets).toEqual(["Rewritten bullet"]);
    expect(chunk.tags).toEqual(["new-tag"]);
  });
});

describe("POST /api/drafts/[id]/tailor: chunks the model omits from its response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("carries an omitted chunk through unmodified instead of silently dropping it", async () => {
    // The model only returned chunk-1 — chunk-2 (a whole job entry) is missing
    // from its response entirely, the exact failure mode confirmed live during
    // the 2026-09-18 audit (see GCU_RESUME_STUDIO_AUDIT.md).
    vi.mocked(tailorChunks).mockResolvedValueOnce({
      ok: true,
      plan: [{ id: "chunk-1", bullets: ["Rewritten bullet"], tags: [] }],
    });
    const { studentD1Query } = await import("@/lib/studentD1");
    vi.mocked(studentD1Query).mockResolvedValueOnce([
      {
        plan: JSON.stringify({
          sections: [
            {
              section: "Experience",
              chunks: [
                { id: "chunk-1", heading: "Job A", bullets: ["Original A"], tags: [] },
                { id: "chunk-2", heading: "Job B", bullets: ["Original B"], tags: ["b-tag"] },
              ],
            },
          ],
        }),
      },
    ]);

    const req = makeRequest({ targetField: "Nursing" });
    const res = await POST(req, { params: { id: "draft-1" } });
    const body = await res.json();

    expect(res.status).toBe(200);
    const chunks = body.proposedPlan.sections[0].chunks;
    expect(chunks).toHaveLength(2);
    const chunkA = chunks.find((c: { id: string }) => c.id === "chunk-1");
    const chunkB = chunks.find((c: { id: string }) => c.id === "chunk-2");
    expect(chunkA.bullets).toEqual(["Rewritten bullet"]);
    // chunk-2 survives with its original content, not dropped.
    expect(chunkB).toBeDefined();
    expect(chunkB.heading).toBe("Job B");
    expect(chunkB.bullets).toEqual(["Original B"]);
    expect(chunkB.tags).toEqual(["b-tag"]);
  });
});
