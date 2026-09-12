import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { getStudentContext } from "@/lib/studentContext";
import { studentRest, withReturnRepresentation } from "@/lib/studentSupabase";
import { createDraft, type DraftPlan, type DraftRow } from "@/lib/drafts";

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
    const { mode, plan, category, niche, name } = (await req.json()) as {
      mode: "new" | "apply";
      plan: DraftPlan;
      category?: string;
      niche?: string;
      name?: string;
    };

    if (mode !== "new" && mode !== "apply") {
      return NextResponse.json({ error: "mode must be 'new' or 'apply'" }, { status: 400 });
    }
    if (!plan?.sections) {
      return NextResponse.json({ error: "plan is required" }, { status: 400 });
    }

    if (mode === "new") {
      const draft = await createDraft(userId, ctx.supabase, ctx.workerUrl, {
        name: name?.trim() || `${category ?? "Tailored"} draft`,
        category: category ?? null,
        niche: niche ?? null,
        isDefault: false,
        plan,
      });
      return NextResponse.json({ ok: true, draft });
    }

    const rows = await studentRest<DraftRow[]>(
      ctx.supabase,
      `drafts?id=eq.${params.id}`,
      withReturnRepresentation({
        method: "PATCH",
        body: JSON.stringify({ plan, category: category ?? undefined, niche: niche ?? undefined, updated_at: new Date().toISOString() }),
      }),
    );
    if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, draft: rows[0] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
