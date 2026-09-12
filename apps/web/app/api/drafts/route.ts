import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { getStudentContext } from "@/lib/studentContext";
import { studentRest } from "@/lib/studentSupabase";
import type { DraftRow } from "@/lib/drafts";

// Backs the resume bank screen.
export async function GET() {
  try {
    const userId = await requireUserId();
    const ctx = await getStudentContext(userId);
    const drafts = await studentRest<DraftRow[]>(
      ctx.supabase,
      "drafts?select=id,name,category,niche,is_default,slug,source_updated_at,created_at,updated_at&order=created_at.asc",
    );
    return NextResponse.json({ drafts });
  } catch (err) {
    return toErrorResponse(err);
  }
}
