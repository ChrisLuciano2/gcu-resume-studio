import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { consumePendingOAuth } from "@/lib/oauthState";
import { exchangeCodeForToken } from "@/lib/supabaseManagement";
import { provisionSupabase } from "@/lib/provisioning/orchestrator";
import { closeTabHtml } from "@/lib/closeTabHtml";

// The Connect Accounts UI opens this flow in a new tab and polls
// /api/provisioning/status for progress rather than expecting a redirect back
// into the original tab (per the design brief) — so this handler's job is just to
// land the tokens, kick off provisioning in the background, and tell the student
// they can close this tab.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) {
    return htmlError("Missing code or state from Supabase.");
  }

  const pending = consumePendingOAuth("supabase", state);
  if (!pending) {
    return htmlError("This connection link expired or was already used. Close this tab and try again.");
  }

  try {
    const tokens = await exchangeCodeForToken(code, pending.verifier);
    await prisma.connection.update({
      where: { userId_provider: { userId: pending.userId, provider: "SUPABASE" } },
      data: {
        method: "OAUTH",
        status: "CONNECTING",
        encryptedAccessToken: encryptSecret(tokens.access_token),
        encryptedRefreshToken: encryptSecret(tokens.refresh_token),
        lastError: null,
      },
    });

    // Fire-and-forget: provisioning (project creation can take minutes) runs in
    // the background while the original tab polls /api/provisioning/status.
    void provisionSupabase(pending.userId).catch((err) => {
      console.error("supabase provisioning failed", err);
    });

    return new NextResponse(closeTabHtml("Supabase connected. Setting up your project now…"), {
      headers: { "Content-Type": "text/html" },
    });
  } catch (err) {
    console.error(err);
    return htmlError("Something went wrong connecting Supabase. Close this tab and try again.");
  }
}

function htmlError(message: string) {
  return new NextResponse(closeTabHtml(message, true), {
    status: 400,
    headers: { "Content-Type": "text/html" },
  });
}
