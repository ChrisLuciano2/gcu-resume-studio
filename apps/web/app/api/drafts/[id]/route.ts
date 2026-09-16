import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { getStudentContext } from "@/lib/studentContext";
import { studentD1Query } from "@/lib/studentD1";
import { deleteDraft, mapDraftRow } from "@/lib/drafts";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const ctx = await getStudentContext(userId);
    const rows = await studentD1Query<Parameters<typeof mapDraftRow>[0]>(
      ctx.d1,
      "SELECT * FROM drafts WHERE id = ?",
      [params.id],
    );
    if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ draft: mapDraftRow(rows[0]) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Rename only — a draft's slug (and therefore its public link) never changes on rename. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const ctx = await getStudentContext(userId);
    const { name } = await req.json();
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    await studentD1Query(ctx.d1, "UPDATE drafts SET name = ?, updated_at = ? WHERE id = ?", [
      name,
      new Date().toISOString(),
      params.id,
    ]);
    const rows = await studentD1Query<Parameters<typeof mapDraftRow>[0]>(ctx.d1, "SELECT * FROM drafts WHERE id = ?", [params.id]);
    if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ draft: mapDraftRow(rows[0]) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const ctx = await getStudentContext(userId);
    const rows = await studentD1Query<{ slug: string; is_default: number }>(
      ctx.d1,
      "SELECT slug, is_default FROM drafts WHERE id = ?",
      [params.id],
    );
    const draft = rows[0];
    if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (draft.is_default === 1) {
      return NextResponse.json({ error: "the default draft can't be deleted" }, { status: 400 });
    }
    await deleteDraft(ctx.d1, draft.slug);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
