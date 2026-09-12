import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { studentRest } from "@/lib/studentSupabase";
import type { DraftRow } from "@/lib/drafts";

/**
 * Public recruiter-facing route. A recruiter link carries only a slug — this is
 * the ONLY place in the central DB that maps a bare slug back to a student
 * (PublicDraftIndex), since all draft content lives in the student's own
 * Supabase. Serves exactly that one draft's locked `plan`, never another
 * draft's or another student's content.
 */
export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const index = await prisma.publicDraftIndex.findUnique({ where: { slug: params.slug } });
  if (!index) return NextResponse.json({ error: "not found" }, { status: 404 });

  const supabaseConn = await prisma.connection.findUnique({
    where: { userId_provider: { userId: index.userId, provider: "SUPABASE" } },
  });
  const meta = (supabaseConn?.metadataJson as Record<string, unknown> | null) ?? {};
  const projectUrl = meta.projectUrl as string | undefined;
  const serviceRoleKeyEncrypted = meta.serviceRoleKeyEncrypted as string | undefined;
  if (!projectUrl || !serviceRoleKeyEncrypted) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const rows = await studentRest<DraftRow[]>(
    { projectUrl, serviceRoleKey: decryptSecret(serviceRoleKeyEncrypted) },
    `drafts?slug=eq.${encodeURIComponent(params.slug)}&select=name,category,niche,plan,updated_at`,
  );
  const draft = rows[0];
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ draft, chatUrl: `/api/r/${params.slug}/chat` });
}
