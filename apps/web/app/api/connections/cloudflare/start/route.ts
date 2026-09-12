import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { startPendingOAuth } from "@/lib/oauthState";
import { buildAuthorizeUrl, generatePkceVerifier, pkceChallengeFromVerifier } from "@/lib/cloudflare";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const userId = await requireUserId();
    const verifier = generatePkceVerifier();
    const nonce = startPendingOAuth("cloudflare", userId, verifier);
    const challenge = await pkceChallengeFromVerifier(verifier);

    await prisma.connection.update({
      where: { userId_provider: { userId, provider: "CLOUDFLARE" } },
      data: { status: "CONNECTING", method: "OAUTH" },
    });

    const url = buildAuthorizeUrl({ state: nonce, codeChallenge: challenge });
    return NextResponse.redirect(url);
  } catch (err) {
    return toErrorResponse(err);
  }
}
