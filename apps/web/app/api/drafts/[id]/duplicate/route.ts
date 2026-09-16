import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { getStudentContext } from "@/lib/studentContext";
import { studentD1Query } from "@/lib/studentD1";
import { createDraft, mapDraftRow } from "@/lib/drafts";

/** Duplicates an existing draft (default or tailored) — a draft-creation path, so it
 *  goes through lib/drafts.ts's createDraft to mint a new slug + PublicDraftIndex row. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const ctx = await getStudentContext(userId);

    const rows = await studentD1Query<Parameters<typeof mapDraftRow>[0]>(ctx.d1, "SELECT * FROM drafts WHERE id = ?", [params.id]);
    const raw = rows[0];
    if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 });
    const source = mapDraftRow(raw);

    const duplicate = await createDraft(userId, ctx.d1, ctx.workerUrl, {
      name: `${source.name} (copy)`,
      category: source.category,
      niche: source.niche,
      isDefault: false,
      plan: source.plan,
      sourceUpdatedAt: source.source_updated_at,
      jobDescription: source.job_description,
      coverLetter: source.cover_letter,
    });

    return NextResponse.json({ ok: true, draft: duplicate });
  } catch (err) {
    return toErrorResponse(err);
  }
}
