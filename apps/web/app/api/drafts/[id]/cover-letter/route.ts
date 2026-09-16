import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { getStudentContext } from "@/lib/studentContext";
import { studentD1Query } from "@/lib/studentD1";
import { generateCoverLetter } from "@/lib/workerClient";
import { MAX_JOB_DESCRIPTION_LENGTH } from "@/lib/jobDescriptionLimit";
import type { DraftPlan } from "@/lib/drafts";

/**
 * Generates a cover letter proposal — never persists anything, same
 * "propose, don't auto-commit" principle as .../tailor, so regenerating can
 * never silently discard an already-saved letter (see PATCH below). Unlike
 * .../tailor, `targetField` isn't required here: a cover letter can
 * reasonably stay generic for a draft that hasn't been tailored to a field.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const ctx = await getStudentContext(userId);
    const { jobDescription } = await req.json();
    if (jobDescription !== undefined && typeof jobDescription !== "string") {
      return NextResponse.json({ error: "jobDescription must be a string" }, { status: 400 });
    }
    if (jobDescription && jobDescription.length > MAX_JOB_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        { error: `jobDescription is too long (max ${MAX_JOB_DESCRIPTION_LENGTH} characters)` },
        { status: 400 },
      );
    }

    const rows = await studentD1Query<{ plan: string; category: string | null; niche: string | null }>(
      ctx.d1,
      "SELECT plan, category, niche FROM drafts WHERE id = ?",
      [params.id],
    );
    const raw = rows[0];
    if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 });
    const plan: DraftPlan = JSON.parse(raw.plan);

    const flatChunks = plan.sections.flatMap((s) =>
      s.chunks.map((c) => ({ heading: c.heading, meta: c.meta, bullets: c.bullets, tags: c.tags })),
    );
    const targetField = raw.niche ?? raw.category ?? undefined;

    const result = await generateCoverLetter(ctx.workerUrl, flatChunks, plan.header, targetField, jobDescription || undefined);
    if (!result.ok || !result.letter) {
      const message =
        result.reason === "timeout"
          ? "The cover letter didn't finish in time — try again."
          : "The cover letter didn't come back in a usable shape — try again.";
      return NextResponse.json({ ok: false, reason: result.reason ?? "unknown", message }, { status: 502 });
    }

    return NextResponse.json({ ok: true, letter: result.letter });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Saves a (possibly hand-edited) cover letter to the draft. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const ctx = await getStudentContext(userId);
    const { letter } = await req.json();
    if (typeof letter !== "string") {
      return NextResponse.json({ error: "letter is required" }, { status: 400 });
    }

    await studentD1Query(ctx.d1, "UPDATE drafts SET cover_letter = ?, updated_at = ? WHERE id = ?", [
      letter,
      new Date().toISOString(),
      params.id,
    ]);
    const rows = await studentD1Query<{ cover_letter: string | null }>(
      ctx.d1,
      "SELECT cover_letter FROM drafts WHERE id = ?",
      [params.id],
    );
    if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, cover_letter: rows[0].cover_letter });
  } catch (err) {
    return toErrorResponse(err);
  }
}
