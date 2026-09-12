import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Public chatbot proxy. Resolves the slug via PublicDraftIndex (the only central
 * table that can answer "whose link is this"), then proxies to that student's own
 * Worker `/chat` — which does the actual retrieval scoping, rate limiting, and
 * caching (see worker-template/src/index.js). If the cached `workerUrl` looks
 * stale (a redeploy changed it), fall back to the live value on the owning
 * Connection and refresh the cache, per PLAN.md.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const index = await prisma.publicDraftIndex.findUnique({ where: { slug: params.slug } });
  if (!index) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { question } = await req.json();
  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  try {
    const result = await proxyToWorker(index.workerUrl, params.slug, question);
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    const fresh = await prisma.connection.findUnique({
      where: { userId_provider: { userId: index.userId, provider: "CLOUDFLARE" } },
    });
    const freshWorkerUrl = (fresh?.metadataJson as Record<string, unknown> | null)?.workerUrl as string | undefined;
    if (!freshWorkerUrl || freshWorkerUrl === index.workerUrl) {
      return NextResponse.json({ error: "this resume's chatbot is temporarily unavailable" }, { status: 502 });
    }

    await prisma.publicDraftIndex.update({ where: { slug: params.slug }, data: { workerUrl: freshWorkerUrl } });
    const retry = await proxyToWorker(freshWorkerUrl, params.slug, question);
    return NextResponse.json(retry.body, { status: retry.status });
  }
}

async function proxyToWorker(workerUrl: string, slug: string, question: string) {
  const res = await fetch(`${workerUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, question }),
    signal: AbortSignal.timeout(25_000),
  });
  const body = await res.json();
  return { status: res.status, body };
}
