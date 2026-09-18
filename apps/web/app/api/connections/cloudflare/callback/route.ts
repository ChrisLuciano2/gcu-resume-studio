import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { consumePendingOAuth } from "@/lib/oauthState";
import { exchangeCodeForToken } from "@/lib/cloudflare";
import { provisionCloudflare } from "@/lib/provisioning/orchestrator";
import { closeTabHtml } from "@/lib/closeTabHtml";

// Provisioning (D1 + KV + Worker deploy) takes a few seconds against the
// Cloudflare API — comfortably under this, but the default is lower on some
// hosts, and there's no margin for a slow Cloudflare API round trip otherwise.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) {
    return htmlError("Missing code or state from Cloudflare.");
  }

  const pending = consumePendingOAuth("cloudflare", state);
  if (!pending) {
    return htmlError("This connection link expired or was already used. Close this tab and try again.");
  }

  try {
    const tokens = await exchangeCodeForToken(code, pending.verifier);
    await prisma.connection.update({
      where: { userId_provider: { userId: pending.userId, provider: "CLOUDFLARE" } },
      data: {
        method: "OAUTH",
        status: "CONNECTING",
        encryptedAccessToken: encryptSecret(tokens.access_token),
        // Cloudflare doesn't always issue a refresh_token (confirmed 2026-09-16
        // against a live exchange) — never assume it's present.
        encryptedRefreshToken: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
        lastError: null,
      },
    });

    // Must be awaited, not fire-and-forget: confirmed live on Vercel 2026-09-17
    // that a serverless function's execution is torn down the instant its HTTP
    // response is sent, silently killing an un-awaited promise mid-flight —
    // provisioning stayed stuck at "pending" forever with no error logged,
    // despite working every time locally under `next dev`'s long-lived process.
    await provisionCloudflare(pending.userId).catch((err) => {
      console.error("cloudflare provisioning failed", err);
    });

    return new NextResponse(closeTabHtml("Cloudflare connected. Deploying your Worker now…"), {
      headers: { "Content-Type": "text/html" },
    });
  } catch (err) {
    console.error(err);
    return htmlError("Something went wrong connecting Cloudflare. Close this tab and try again.");
  }
}

function htmlError(message: string) {
  return new NextResponse(closeTabHtml(message, true), {
    status: 400,
    headers: { "Content-Type": "text/html" },
  });
}
