import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import type { StudentSupabase } from "./studentSupabase";

export interface StudentContext {
  supabase: StudentSupabase;
  workerUrl: string;
}

/** Loads a connected student's Supabase + Worker connection details, decrypted. */
export async function getStudentContext(userId: string): Promise<StudentContext> {
  const [supabaseConn, cloudflareConn] = await Promise.all([
    prisma.connection.findUnique({ where: { userId_provider: { userId, provider: "SUPABASE" } } }),
    prisma.connection.findUnique({ where: { userId_provider: { userId, provider: "CLOUDFLARE" } } }),
  ]);

  if (supabaseConn?.status !== "CONNECTED" || cloudflareConn?.status !== "CONNECTED") {
    throw new NotProvisionedError();
  }

  const supabaseMeta = (supabaseConn.metadataJson as Record<string, unknown> | null) ?? {};
  const cloudflareMeta = (cloudflareConn.metadataJson as Record<string, unknown> | null) ?? {};

  const projectUrl = supabaseMeta.projectUrl as string | undefined;
  const serviceRoleKeyEncrypted = supabaseMeta.serviceRoleKeyEncrypted as string | undefined;
  const workerUrl = cloudflareMeta.workerUrl as string | undefined;

  if (!projectUrl || !serviceRoleKeyEncrypted || !workerUrl) {
    throw new NotProvisionedError();
  }

  return {
    supabase: { projectUrl, serviceRoleKey: decryptSecret(serviceRoleKeyEncrypted) },
    workerUrl,
  };
}

export class NotProvisionedError extends Error {
  constructor() {
    super("Connect and finish provisioning both Supabase and Cloudflare before using this feature");
  }
}
