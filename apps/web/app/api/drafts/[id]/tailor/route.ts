import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { getStudentContext } from "@/lib/studentContext";
import { studentRest } from "@/lib/studentSupabase";
import { tailorChunks } from "@/lib/workerClient";
import type { DraftRow } from "@/lib/drafts";

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
    const { targetField } = await req.json();
    if (typeof targetField !== "string" || !targetField.trim()) {
      return NextResponse.json({ error: "targetField is required" }, { status: 400 });
    }

    const rows = await studentRest<DraftRow[]>(ctx.supabase, `drafts?id=eq.${params.id}&select=plan`);
    const draft = rows[0];
    if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });

    const flatChunks = draft.plan.sections.flatMap((s) =>
      s.chunks.map((c) => ({ id: c.id, section: s.section, heading: c.heading, meta: c.meta, bullets: c.bullets, tags: c.tags })),
    );

    const result = await tailorChunks(ctx.workerUrl, flatChunks, targetField);
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
    const proposedSections = groupIntoSections(result.plan, sectionBySection, draft.plan.sections.map((s) => s.section));

    return NextResponse.json({ ok: true, proposedPlan: { sections: proposedSections } });
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
