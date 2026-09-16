import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { getStudentContext } from "@/lib/studentContext";
import { studentD1Query } from "@/lib/studentD1";

interface DraftListRow {
  id: string;
  name: string;
  category: string | null;
  niche: string | null;
  is_default: number;
  slug: string;
  source_updated_at: string | null;
  created_at: string;
  updated_at: string;
  job_description: string | null;
  cover_letter: string | null;
}

// Backs the resume bank screen. Deliberately doesn't select `plan` — it can be
// large free-form JSON and this view never needs it, same optimization the
// PostgREST version of this query made.
export async function GET() {
  try {
    const userId = await requireUserId();
    const ctx = await getStudentContext(userId);
    const rows = await studentD1Query<DraftListRow>(
      ctx.d1,
      "SELECT id, name, category, niche, is_default, slug, source_updated_at, created_at, updated_at, job_description, cover_letter FROM drafts ORDER BY created_at ASC",
    );
    const drafts = rows.map((r) => ({ ...r, is_default: r.is_default === 1 }));
    return NextResponse.json({ drafts });
  } catch (err) {
    return toErrorResponse(err);
  }
}
