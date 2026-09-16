import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import { studentD1Query } from "./studentD1";
import type { DraftPlan } from "./drafts";

export interface PublicDraft {
  draft: {
    name: string;
    category: string | null;
    niche: string | null;
    plan: DraftPlan;
    updated_at: string;
  };
  chatUrl: string;
}

interface RawPublicDraftRow {
  name: string;
  category: string | null;
  niche: string | null;
  plan: string;
  updated_at: string;
}

/**
 * Public recruiter-facing lookup. A recruiter link carries only a slug — this is
 * the ONLY place in the central DB that maps a bare slug back to a student
 * (PublicDraftIndex), since all draft content lives in the student's own D1
 * database. Serves exactly that one draft's locked `plan`, never another
 * draft's or another student's content. Shared by the JSON API route
 * (app/api/r/[slug]/route.ts) and the public resume page
 * (app/r/[slug]/page.tsx) so there's exactly one implementation of "what a
 * recruiter link resolves to."
 *
 * No auth is possible here by design (recruiters have no account) — see
 * lib/slug.ts for why the slug itself carries 128 bits of randomness as the
 * only access control, and lib/rateLimit.ts for the per-IP throttling both
 * callers apply on top of that.
 */
export async function getPublicDraftBySlug(slug: string): Promise<PublicDraft | null> {
  const index = await prisma.publicDraftIndex.findUnique({ where: { slug } });
  if (!index) return null;

  const cfConnection = await prisma.connection.findUnique({
    where: { userId_provider: { userId: index.userId, provider: "CLOUDFLARE" } },
  });
  const meta = (cfConnection?.metadataJson as Record<string, unknown> | null) ?? {};
  const accountId = meta.accountId as string | undefined;
  const databaseId = meta.databaseId as string | undefined;
  const bearerToken = cfConnection?.encryptedAccessToken
    ? decryptSecret(cfConnection.encryptedAccessToken)
    : cfConnection?.encryptedApiToken
      ? decryptSecret(cfConnection.encryptedApiToken)
      : undefined;
  if (!accountId || !databaseId || !bearerToken) return null;

  const rows = await studentD1Query<RawPublicDraftRow>(
    { accountId, databaseId, bearerToken },
    "SELECT name, category, niche, plan, updated_at FROM drafts WHERE slug = ?",
    [slug],
  );
  const raw = rows[0];
  if (!raw) return null;

  return {
    draft: { name: raw.name, category: raw.category, niche: raw.niche, plan: JSON.parse(raw.plan), updated_at: raw.updated_at },
    chatUrl: `/api/r/${slug}/chat`,
  };
}
