import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { getStudentContext } from "@/lib/studentContext";
import { studentD1Query } from "@/lib/studentD1";
import { createDraft, mapDraftRow, type DraftPlan } from "@/lib/drafts";
import { MAX_JOB_DESCRIPTION_LENGTH } from "@/lib/jobDescriptionLimit";

/**
 * Commits a proposed tailoring plan (from .../tailor) as either a brand-new draft
 * or an in-place update to the current one — the per-drag choice from the design
 * brief that prevents silent overwrites. `mode: "new"` is a draft-creation path,
 * so it goes through lib/drafts.ts's createDraft to keep PublicDraftIndex in sync.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const ctx = await getStudentContext(userId);
    const { mode, plan, category, niche, name, jobDescription } = (await req.json()) as {
      mode: "new" | "apply";
      plan: DraftPlan;
      category?: string;
      niche?: string;
      name?: string;
      jobDescription?: string;
    };

    if (mode !== "new" && mode !== "apply") {
      return NextResponse.json({ error: "mode must be 'new' or 'apply'" }, { status: 400 });
    }
    if (!plan?.sections) {
      return NextResponse.json({ error: "plan is required" }, { status: 400 });
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

    if (mode === "new") {
      const draft = await createDraft(userId, ctx.d1, ctx.workerUrl, {
        name: name?.trim() || `${category ?? "Tailored"} draft`,
        category: category ?? null,
        niche: niche ?? null,
        isDefault: false,
        plan,
        jobDescription: jobDescription ?? null,
      });
      return NextResponse.json({ ok: true, draft });
    }

    const existing = await studentD1Query<{ category: string | null; niche: string | null; job_description: string | null }>(
      ctx.d1,
      "SELECT category, niche, job_description FROM drafts WHERE id = ?",
      [params.id],
    );
    if (!existing[0]) return NextResponse.json({ error: "not found" }, { status: 404 });

    await studentD1Query(
      ctx.d1,
      "UPDATE drafts SET plan = ?, category = ?, niche = ?, job_description = ?, updated_at = ? WHERE id = ?",
      [
        JSON.stringify(plan),
        category ?? existing[0].category,
        niche ?? existing[0].niche,
        jobDescription ?? existing[0].job_description,
        new Date().toISOString(),
        params.id,
      ],
    );
    const rows = await studentD1Query<Parameters<typeof mapDraftRow>[0]>(ctx.d1, "SELECT * FROM drafts WHERE id = ?", [params.id]);
    if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, draft: mapDraftRow(rows[0]) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
