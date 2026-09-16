import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { getStudentContext } from "@/lib/studentContext";
import { studentD1Query } from "@/lib/studentD1";
import { tailorChunks } from "@/lib/workerClient";
import { MAX_JOB_DESCRIPTION_LENGTH } from "@/lib/jobDescriptionLimit";
import type { DraftPlan } from "@/lib/drafts";

/**
 * Proposes a rewrite for a target field — never persists anything. The editor's
 * review step (save as new draft / apply in place / discard) is what actually
 * commits, via .../commit. This split is what makes the "asked every time"
 * overwrite protection from the design brief possible: nothing is written until
 * the student chooses where it goes.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const ctx = await getStudentContext(userId);
    const { targetField, jobDescription } = await req.json();
    if (typeof targetField !== "string" || !targetField.trim()) {
      return NextResponse.json({ error: "targetField is required" }, { status: 400 });
    }
    if (jobDescription !== undefined && typeof jobDescription !== "string") {
      return NextResponse.json({ error: "jobDescription must be a string" }, { status: 400 });
    }
    if (jobDescription && jobDescription.length > MAX_JOB_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        { error: `jobDescription is too long (max ${MAX_JOB_DESCRIPTION_LENGTH} characters)` },
        { status: 400 },
      );
    }

    const rows = await studentD1Query<{ plan: string }>(ctx.d1, "SELECT plan FROM drafts WHERE id = ?", [params.id]);
    const raw = rows[0];
    if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 });
    const plan: DraftPlan = JSON.parse(raw.plan);

    const flatChunks = plan.sections.flatMap((s) =>
      s.chunks.map((c) => ({ id: c.id, section: s.section, heading: c.heading, meta: c.meta, bullets: c.bullets, tags: c.tags })),
    );

    const result = await tailorChunks(ctx.workerUrl, flatChunks, targetField, jobDescription || undefined);
    if (!result.ok || !result.plan) {
      // Reason-specific message: "didn't finish in time" was previously shown
      // for every failure mode, including unparseable_ai_response — a real case
      // (confirmed live: JSON Mode still occasionally produces invalid output
      // even under a schema) where the rewrite actually completed fast, it just
      // didn't come back in a usable shape. Telling the student to "try again"
      // is still the right call in both cases, but the label shouldn't lie about
      // what happened.
      const message =
        result.reason === "timeout"
          ? "The rewrite didn't finish in time — try again."
          : "The rewrite didn't come back in a usable shape — try again.";
      return NextResponse.json({ ok: false, reason: result.reason ?? "unknown", message }, { status: 502 });
    }

    // Re-sectioned using the original chunk->section mapping; the AI only
    // reorders/rewrites bullets and tags, it never invents new section names.
    const sectionBySection = new Map(flatChunks.map((c) => [c.id, c.section]));
    const proposedSections = groupIntoSections(result.plan, sectionBySection, plan.sections.map((s) => s.section));

    // `header` (candidate name/contact block, used for cover-letter
    // generation) isn't touched by tailoring at all — carry it through
    // explicitly, or it silently disappears the first time a draft is
    // tailored, since this constructs a brand-new plan object rather than
    // mutating the existing one.
    return NextResponse.json({ ok: true, proposedPlan: { sections: proposedSections, header: plan.header } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function groupIntoSections(
  rewritten: Array<{ id: string; bullets: string[]; tags: string[] }>,
  sectionOf: Map<string, string>,
  sectionOrder: string[],
) {
  const bySection = new Map<string, Array<{ id: string; bullets: string[]; tags: string[] }>>();
  for (const chunk of rewritten) {
    const section = sectionOf.get(chunk.id) ?? "General";
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section)!.push(chunk);
  }
  const order = sectionOrder.filter((s) => bySection.has(s));
  for (const s of bySection.keys()) if (!order.includes(s)) order.push(s);
  return order.map((section) => ({ section, chunks: bySection.get(section)! }));
}
