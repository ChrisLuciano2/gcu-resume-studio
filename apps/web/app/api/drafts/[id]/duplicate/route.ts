import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { getStudentContext } from "@/lib/studentContext";
import { studentRest } from "@/lib/studentSupabase";
import { createDraft, type DraftRow } from "@/lib/drafts";

/** Duplicates an existing draft (default or tailored) — a draft-creation path, so it
 *  goes through lib/drafts.ts's createDraft to mint a new slug + PublicDraftIndex row. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const ctx = await getStudentContext(userId);

    const rows = await studentRest<DraftRow[]>(ctx.supabase, `drafts?id=eq.${params.id}&select=*`);
    const source = rows[0];
    if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });

    const duplicate = await createDraft(userId, ctx.supabase, ctx.workerUrl, {
      name: `${source.name} (copy)`,
      category: source.category,
      niche: source.niche,
      isDefault: false,
      plan: source.plan,
      sourceUpdatedAt: source.source_updated_at,
    });

    return NextResponse.json({ ok: true, draft: duplicate });
  } catch (err) {
    return toErrorResponse(err);
  }
}
