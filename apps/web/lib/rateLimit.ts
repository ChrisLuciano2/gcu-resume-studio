import { NextRequest } from "next/server";

// In-memory fixed-window limiter. Good enough for the central app's current
// single-instance deployment (it's a thin orchestrator, not the thing that
// scales — see PLAN.md); if this app is ever run as multiple instances behind
// a load balancer, swap the Map below for a shared store (e.g. Postgres via
// prisma, since that's already the only datastore this app has) so instances
// share one counter.
const buckets = new Map<string, { count: number; resetAt: number }>();

// Evict expired buckets opportunistically so this Map can't grow unbounded
// under sustained traffic from many distinct keys (e.g. an IP-scanning bot
// hitting many slugs). Runs at most once a minute.
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Returns true if the call under `key` is allowed, false if it should be
 * rejected (429). `key` should already include whatever scope you want rate
 * limits enforced per (e.g. `${routeName}:${ip}` or `${routeName}:${ip}:${slug}`).
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

// Best-effort caller IP for a public, unauthenticated route. Trusts
// X-Forwarded-For because this app is expected to run behind a reverse proxy
// (see README/SETUP_CHECKLIST deployment notes) — a direct-to-Node deployment
// would need to strip/ignore client-supplied XFF instead, but that's not this
// app's deployment shape today.
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}
