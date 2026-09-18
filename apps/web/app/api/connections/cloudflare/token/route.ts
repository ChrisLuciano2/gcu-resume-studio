import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { verifyToken } from "@/lib/cloudflare";
import { provisionCloudflare } from "@/lib/provisioning/orchestrator";

// Fallback path from the design brief: "Cloudflare's actual integration path may
// lean toward a scoped API token... build the Cloudflare card flexibly." OAuth is
// primary (see .../cloudflare/start); this covers accounts where OAuth setup is
// awkward.
// See callback/route.ts's comment on maxDuration and the awaited provisioning
// call below — same fix, same reason, needed on this path too.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { token } = await req.json();
    if (typeof token !== "string" || token.length < 10) {
      return NextResponse.json({ error: "a Cloudflare API token is required" }, { status: 400 });
    }

    const { valid, status } = await verifyToken(token);
    if (!valid) {
      return NextResponse.json({ error: `token is not active (status: ${status})` }, { status: 400 });
    }

    await prisma.connection.update({
      where: { userId_provider: { userId, provider: "CLOUDFLARE" } },
      data: {
        method: "TOKEN",
        status: "CONNECTING",
        encryptedApiToken: encryptSecret(token),
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        lastError: null,
      },
    });

    await provisionCloudflare(userId).catch((err) => {
      console.error("cloudflare provisioning (token path) failed", err);
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
