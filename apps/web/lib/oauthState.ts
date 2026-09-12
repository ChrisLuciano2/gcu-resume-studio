import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// Short-lived, signed cookie carrying the PKCE verifier + CSRF nonce between an
// OAuth start and callback request. Keyed by provider so Supabase and Cloudflare
// flows started in the same browser session don't collide.

interface PendingOAuth {
  userId: string;
  nonce: string;
  verifier: string;
}

function cookieName(provider: "supabase" | "cloudflare") {
  return `oauth_pending_${provider}`;
}

function sign(value: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function startPendingOAuth(provider: "supabase" | "cloudflare", userId: string, verifier: string): string {
  const nonce = randomBytes(16).toString("base64url");
  const payload: PendingOAuth = { userId, nonce, verifier };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encoded);
  cookies().set(cookieName(provider), `${encoded}.${signature}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10, // OAuth round trips should complete in minutes, not linger
  });
  return nonce;
}

export function consumePendingOAuth(
  provider: "supabase" | "cloudflare",
  expectedState: string,
): PendingOAuth | null {
  const raw = cookies().get(cookieName(provider))?.value;
  cookies().delete(cookieName(provider));
  if (!raw) return null;

  const dot = raw.lastIndexOf(".");
  if (dot === -1) return null;
  const encoded = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expectedSig = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const payload: PendingOAuth = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (payload.nonce !== expectedState) return null;
  return payload;
}
