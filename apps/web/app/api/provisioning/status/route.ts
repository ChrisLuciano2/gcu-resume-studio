import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { getProvisioningStatus } from "@/lib/provisioning/orchestrator";
import { prisma } from "@/lib/db";

// Polled by the Connect Accounts screen — per the design brief, connection state
// is discovered by polling rather than a push/redirect back into the original tab.
export async function GET() {
  try {
    const userId = await requireUserId();
    const [steps, connections] = await Promise.all([
      getProvisioningStatus(userId),
      prisma.connection.findMany({ where: { userId }, select: { provider: true, status: true, method: true, lastError: true } }),
    ]);
    return NextResponse.json({ steps, connections });
  } catch (err) {
    return toErrorResponse(err);
  }
}
