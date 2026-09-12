import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { getStudentContext } from "@/lib/studentContext";
import { studentRest, withReturnRepresentation } from "@/lib/studentSupabase";
import { deleteDraft, type DraftRow } from "@/lib/drafts";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const ctx = await getStudentContext(userId);
    const rows = await studentRest<DraftRow[]>(ctx.supabase, `drafts?id=eq.${params.id}&select=*`);
    if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ draft: rows[0] });
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
    const rows = await studentRest<DraftRow[]>(
      ctx.supabase,
      `drafts?id=eq.${params.id}`,
      withReturnRepresentation({ method: "PATCH", body: JSON.stringify({ name, updated_at: new Date().toISOString() }) }),
    );
    if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ draft: rows[0] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const ctx = await getStudentContext(userId);
    const rows = await studentRest<DraftRow[]>(ctx.supabase, `drafts?id=eq.${params.id}&select=slug,is_default`);
    const draft = rows[0];
    if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (draft.is_default) {
      return NextResponse.json({ error: "the default draft can't be deleted" }, { status: 400 });
    }
    await deleteDraft(ctx.supabase, draft.slug);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
