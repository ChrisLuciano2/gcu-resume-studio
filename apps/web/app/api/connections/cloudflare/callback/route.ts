import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { consumePendingOAuth } from "@/lib/oauthState";
import { exchangeCodeForToken } from "@/lib/cloudflare";
import { provisionCloudflareWhenReady } from "@/lib/provisioning/orchestrator";
import { closeTabHtml } from "@/lib/closeTabHtml";

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
        encryptedRefreshToken: encryptSecret(tokens.refresh_token),
        lastError: null,
      },
    });

    void provisionCloudflareWhenReady(pending.userId).catch((err) => {
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
