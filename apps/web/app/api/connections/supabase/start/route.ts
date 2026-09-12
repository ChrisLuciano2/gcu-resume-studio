import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { startPendingOAuth } from "@/lib/oauthState";
import { buildAuthorizeUrl, generatePkcePair, pkceChallengeFromVerifier } from "@/lib/supabaseManagement";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const userId = await requireUserId();
    const { verifier } = generatePkcePair();
    const nonce = startPendingOAuth("supabase", userId, verifier);
    const challenge = await pkceChallengeFromVerifier(verifier);

    await prisma.connection.update({
      where: { userId_provider: { userId, provider: "SUPABASE" } },
      data: { status: "CONNECTING" },
    });

    const url = buildAuthorizeUrl({ state: nonce, codeChallenge: challenge });
    return NextResponse.redirect(url);
  } catch (err) {
    return toErrorResponse(err);
  }
}
