import { prisma } from "./db";
import { makeSlug } from "./slug";
import { studentRest, withReturnRepresentation, type StudentSupabase } from "./studentSupabase";

export interface DraftPlan {
  sections: Array<{
    section: string;
    chunks: Array<{ id: string; heading?: string; meta?: string; bullets: string[]; tags: string[] }>;
  }>;
}

export interface DraftRow {
  id: string;
  name: string;
  category: string | null;
  niche: string | null;
  is_default: boolean;
  slug: string;
  plan: DraftPlan;
  source_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Creates a `drafts` row in the student's own Supabase AND upserts its
 * `PublicDraftIndex` row in the central DB, in that order, so a row never exists
 * on one side without the other. This is the single place every draft-creation
 * path (resumes/ingest's default draft, tailor's saveNew, duplicate) should go
 * through — see PLAN.md's "exhaustive list of writers" note.
 */
export async function createDraft(
  userId: string,
  supabase: StudentSupabase,
  workerUrl: string,
  input: {
    name: string;
    category?: string | null;
    niche?: string | null;
    isDefault?: boolean;
    plan: DraftPlan;
    sourceUpdatedAt?: string | null;
  },
): Promise<DraftRow> {
  const slug = makeSlug(input.name);
  const rows = await studentRest<DraftRow[]>(
    supabase,
    "drafts",
    withReturnRepresentation({
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        category: input.category ?? null,
        niche: input.niche ?? null,
        is_default: input.isDefault ?? false,
        slug,
        plan: input.plan,
        source_updated_at: input.sourceUpdatedAt ?? null,
      }),
    }),
  );
  const draft = rows[0];
  if (!draft) throw new Error("Supabase did not return the created draft row");

  await prisma.publicDraftIndex.create({
    data: { slug: draft.slug, userId, workerUrl },
  });

  return draft;
}

/** Removes both sides of a draft: the student's row and its public routing index. */
export async function deleteDraft(supabase: StudentSupabase, slug: string): Promise<void> {
  await studentRest(supabase, `drafts?slug=eq.${encodeURIComponent(slug)}`, { method: "DELETE" });
  await prisma.publicDraftIndex.delete({ where: { slug } }).catch(() => {
    // Already gone is fine — deletion must be idempotent from the caller's view.
  });
}
