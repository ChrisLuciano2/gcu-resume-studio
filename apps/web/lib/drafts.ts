import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { makeSlug } from "./slug";
import { studentD1Query, type StudentD1 } from "./studentD1";

export interface DraftPlan {
  sections: Array<{
    section: string;
    chunks: Array<{ id: string; heading?: string; meta?: string; bullets: string[]; tags: string[] }>;
  }>;
  /** The candidate's name/contact block, captured from the raw resume text at
   *  upload time (see lib/chunking.ts's extractResumeHeader) — chunking never
   *  captures it, since it lives before the first section heading. Used for
   *  cover-letter generation. Must be explicitly carried through anywhere a
   *  plan gets rebuilt (e.g. a tailor proposal), or it silently disappears. */
  header?: string;
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
  job_description: string | null;
  cover_letter: string | null;
}

/** Raw shape a `drafts` row comes back as from D1 — SQLite has no boolean or
 *  JSON column type, so `is_default` is 0/1 and `plan` is a JSON string. */
interface RawDraftRow {
  id: string;
  name: string;
  category: string | null;
  niche: string | null;
  is_default: number;
  slug: string;
  plan: string;
  source_updated_at: string | null;
  created_at: string;
  updated_at: string;
  job_description: string | null;
  cover_letter: string | null;
}

export function mapDraftRow(raw: RawDraftRow): DraftRow {
  return { ...raw, is_default: raw.is_default === 1, plan: JSON.parse(raw.plan) };
}

/**
 * Creates a `drafts` row in the student's own D1 database AND upserts its
 * `PublicDraftIndex` row in the central DB, in that order, so a row never exists
 * on one side without the other. This is the single place every draft-creation
 * path (resumes/ingest's default draft, tailor's saveNew, duplicate) should go
 * through — see PLAN.md's "exhaustive list of writers" note.
 */
export async function createDraft(
  userId: string,
  d1: StudentD1,
  workerUrl: string,
  input: {
    name: string;
    category?: string | null;
    niche?: string | null;
    isDefault?: boolean;
    plan: DraftPlan;
    sourceUpdatedAt?: string | null;
    jobDescription?: string | null;
    coverLetter?: string | null;
  },
): Promise<DraftRow> {
  const id = randomUUID();
  const slug = makeSlug(input.name);
  const now = new Date().toISOString();

  await studentD1Query(
    d1,
    `INSERT INTO drafts (id, name, category, niche, is_default, slug, plan, source_updated_at, created_at, updated_at, job_description, cover_letter)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.category ?? null,
      input.niche ?? null,
      input.isDefault ? 1 : 0,
      slug,
      JSON.stringify(input.plan),
      input.sourceUpdatedAt ?? null,
      now,
      now,
      input.jobDescription ?? null,
      input.coverLetter ?? null,
    ],
  );

  await prisma.publicDraftIndex.create({ data: { slug, userId, workerUrl } });

  return {
    id,
    name: input.name,
    category: input.category ?? null,
    niche: input.niche ?? null,
    is_default: input.isDefault ?? false,
    slug,
    plan: input.plan,
    source_updated_at: input.sourceUpdatedAt ?? null,
    created_at: now,
    updated_at: now,
    job_description: input.jobDescription ?? null,
    cover_letter: input.coverLetter ?? null,
  };
}

/** Removes both sides of a draft: the student's row and its public routing index. */
export async function deleteDraft(d1: StudentD1, slug: string): Promise<void> {
  await studentD1Query(d1, "DELETE FROM drafts WHERE slug = ?", [slug]);
  await prisma.publicDraftIndex.delete({ where: { slug } }).catch(() => {
    // Already gone is fine — deletion must be idempotent from the caller's view.
  });
}
