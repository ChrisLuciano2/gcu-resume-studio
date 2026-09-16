import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import type { StudentD1 } from "./studentD1";

export interface StudentContext {
  d1: StudentD1;
  workerUrl: string;
}

/** Loads a connected student's D1 + Worker connection details, decrypted. */
export async function getStudentContext(userId: string): Promise<StudentContext> {
  const connection = await prisma.connection.findUnique({
    where: { userId_provider: { userId, provider: "CLOUDFLARE" } },
  });

  if (connection?.status !== "CONNECTED") {
    throw new NotProvisionedError();
  }

  const meta = (connection.metadataJson as Record<string, unknown> | null) ?? {};
  const accountId = meta.accountId as string | undefined;
  const databaseId = meta.databaseId as string | undefined;
  const workerUrl = meta.workerUrl as string | undefined;

  const bearerToken = connection.encryptedAccessToken
    ? decryptSecret(connection.encryptedAccessToken)
    : connection.encryptedApiToken
      ? decryptSecret(connection.encryptedApiToken)
      : undefined;

  if (!accountId || !databaseId || !workerUrl || !bearerToken) {
    throw new NotProvisionedError();
  }

  return {
    d1: { accountId, databaseId, bearerToken },
    workerUrl,
  };
}

export class NotProvisionedError extends Error {
  constructor() {
    super("Connect Cloudflare and finish provisioning before using this feature");
  }
}
