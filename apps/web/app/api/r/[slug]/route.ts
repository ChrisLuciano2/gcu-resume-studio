import { NextRequest, NextResponse } from "next/server";
import { getPublicDraftBySlug } from "@/lib/publicDraft";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

/**
 * JSON API for a recruiter link — thin wrapper around lib/publicDraft.ts's
 * shared lookup (also used directly by the server-rendered app/r/[slug]/page.tsx
 * so that page doesn't pay for an extra internal HTTP round-trip). Kept as its
 * own route for the chat widget and any future API consumers.
 */
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  if (!checkRateLimit(`r:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  const result = await getPublicDraftBySlug(params.slug);
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(result);
}
