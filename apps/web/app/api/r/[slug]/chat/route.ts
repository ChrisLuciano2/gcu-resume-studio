import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

/**
 * Public chatbot proxy. Resolves the slug via PublicDraftIndex (the only central
 * table that can answer "whose link is this"), then proxies to that student's own
 * Worker `/chat` — which does the actual retrieval scoping, and caching (see
 * worker-template/src/index.js). That Worker only enforces an aggregate
 * per-slug daily budget, with no per-requester throttling, so a single visitor
 * could burn a student's whole day's budget in seconds; rate-limit per IP here
 * as well, before it ever reaches the worker.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  if (!checkRateLimit(`chat:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  const index = await prisma.publicDraftIndex.findUnique({ where: { slug: params.slug } });
  if (!index) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { question } = await req.json();
  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  try {
    const result = await proxyToWorker(index.workerUrl, params.slug, question);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("chat proxy: initial attempt failed", err);
    try {
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
    } catch (retryErr) {
      console.error("chat proxy: retry with refreshed workerUrl also failed", retryErr);
      return NextResponse.json({ error: "this resume's chatbot is temporarily unavailable" }, { status: 502 });
    }
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
