import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../db";
import { decryptSecret, encryptSecret } from "../crypto";
import * as supabaseMgmt from "../supabaseManagement";
import * as cloudflare from "../cloudflare";

const SCHEMA_SQL = readFileSync(join(process.cwd(), "lib/provisioning/schema.sql"), "utf8");
const WORKER_SOURCE_PATH = join(process.cwd(), "..", "..", "worker-template", "src", "index.js");

type StepState = "pending" | "active" | "done" | "error";
export interface ProvisioningStep {
  key: string;
  label: string;
  state: StepState;
  completedAt: string | null;
}

const STEP_DEFS: Array<{ key: string; label: string }> = [
  { key: "supabase_project", label: "Create Supabase project" },
  { key: "supabase_schema", label: "Create schema" },
  { key: "cloudflare_kv", label: "Bind KV namespace" },
  { key: "cloudflare_worker", label: "Deploy Worker" },
];

async function getOrInitRun(userId: string): Promise<ProvisioningStep[]> {
  const existing = await prisma.provisioningRun.findUnique({ where: { userId } });
  if (existing) return existing.stepsJson as unknown as ProvisioningStep[];

  const steps: ProvisioningStep[] = STEP_DEFS.map((d) => ({ ...d, state: "pending", completedAt: null }));
  await prisma.provisioningRun.create({ data: { userId, stepsJson: steps as unknown as object } });
  return steps;
}

async function updateStep(userId: string, key: string, state: StepState) {
  const steps = await getOrInitRun(userId);
  const next = steps.map((s) =>
    s.key === key ? { ...s, state, completedAt: state === "done" ? new Date().toISOString() : s.completedAt } : s,
  );
  await prisma.provisioningRun.update({ where: { userId }, data: { stepsJson: next as unknown as object } });
}

export async function getProvisioningStatus(userId: string): Promise<ProvisioningStep[]> {
  return getOrInitRun(userId);
}

/**
 * Runs the Supabase side of provisioning: create project, wait for it to come up,
 * run the schema, store keys. Safe to call again after a partial failure — each
 * step re-checks whether its work is already done via the Connection row.
 */
export async function provisionSupabase(userId: string): Promise<void> {
  await getOrInitRun(userId);
  const connection = await prisma.connection.findUniqueOrThrow({
    where: { userId_provider: { userId, provider: "SUPABASE" } },
  });
  if (!connection.encryptedAccessToken) {
    throw new Error("Supabase connection has no access token — OAuth flow did not complete");
  }
  const accessToken = decryptSecret(connection.encryptedAccessToken);

  await prisma.connection.update({ where: { id: connection.id }, data: { status: "CONNECTING" } });
  await updateStep(userId, "supabase_project", "active");

  try {
    const meta = (connection.metadataJson as Record<string, unknown> | null) ?? {};
    let ref = meta.projectRef as string | undefined;

    if (!ref) {
      const project = await supabaseMgmt.createProject(accessToken, `resume-studio-${userId.slice(0, 8)}`);
      ref = project.id;
      await saveMeta(connection.id, { ...meta, projectRef: ref });
    }

    const active = await supabaseMgmt.waitUntilActive(accessToken, ref);
    const projectUrl = `https://${active.id}.supabase.co`;
    await updateStep(userId, "supabase_project", "done");

    await updateStep(userId, "supabase_schema", "active");
    await supabaseMgmt.runQuery(accessToken, ref, SCHEMA_SQL);
    const { anonKey, serviceRoleKey } = await supabaseMgmt.getApiKeys(accessToken, ref);

    const latestMeta = await getMeta(connection.id);
    await saveMeta(connection.id, {
      ...latestMeta,
      projectRef: ref,
      projectUrl,
      anonKey,
      serviceRoleKeyEncrypted: encryptSecret(serviceRoleKey),
    });
    await updateStep(userId, "supabase_schema", "done");
    await prisma.connection.update({ where: { id: connection.id }, data: { status: "CONNECTED", lastError: null } });
  } catch (err) {
    await failStep(userId, connection.id, currentActiveStep(await getProvisioningStatus(userId)), err);
    throw err;
  }
}

/**
 * Runs the Cloudflare side: KV namespace, then the Worker deploy (secret_text vs
 * plain_text bindings — see lib/cloudflare.ts). Requires Supabase to have already
 * produced a service-role key, since the Worker is bound to it at deploy time.
 */
export async function provisionCloudflare(userId: string): Promise<void> {
  await getOrInitRun(userId);
  const [cfConnection, supabaseConnection] = await Promise.all([
    prisma.connection.findUniqueOrThrow({ where: { userId_provider: { userId, provider: "CLOUDFLARE" } } }),
    prisma.connection.findUniqueOrThrow({ where: { userId_provider: { userId, provider: "SUPABASE" } } }),
  ]);

  const supabaseMeta = (supabaseConnection.metadataJson as Record<string, unknown> | null) ?? {};
  if (!supabaseMeta.projectUrl || !supabaseMeta.serviceRoleKeyEncrypted) {
    throw new Error("Cloudflare provisioning requires Supabase provisioning to finish first");
  }

  const bearerToken = cfConnection.encryptedAccessToken
    ? decryptSecret(cfConnection.encryptedAccessToken)
    : cfConnection.encryptedApiToken
      ? decryptSecret(cfConnection.encryptedApiToken)
      : (() => {
          throw new Error("Cloudflare connection has no usable token");
        })();

  await prisma.connection.update({ where: { id: cfConnection.id }, data: { status: "CONNECTING" } });

  try {
    const meta = (cfConnection.metadataJson as Record<string, unknown> | null) ?? {};
    const accountId = (meta.accountId as string) ?? (await pickFirstAccount(bearerToken));

    await updateStep(userId, "cloudflare_kv", "active");
    let kvNamespaceId = meta.kvNamespaceId as string | undefined;
    if (!kvNamespaceId) {
      const ns = await cloudflare.createKvNamespace(bearerToken, accountId, `resume-studio-${userId.slice(0, 8)}`);
      kvNamespaceId = ns.id;
      await saveMeta(cfConnection.id, { ...meta, accountId, kvNamespaceId });
    }
    await updateStep(userId, "cloudflare_kv", "done");

    await updateStep(userId, "cloudflare_worker", "active");
    const scriptName = `resume-studio-${userId.slice(0, 12)}`;
    const moduleSource = readFileSync(WORKER_SOURCE_PATH, "utf8");
    await cloudflare.deployWorker({
      bearerToken,
      accountId,
      scriptName,
      moduleSource,
      kvNamespaceId,
      supabaseUrl: supabaseMeta.projectUrl as string,
      supabaseServiceKey: decryptSecret(supabaseMeta.serviceRoleKeyEncrypted as string),
      dailyChatBudget: 20,
    });
    const workerUrl = await cloudflare.enableWorkersDevRoute(bearerToken, accountId, scriptName);
    // A freshly created workers.dev subdomain isn't immediately resolvable (real
    // DNS propagation delay, confirmed live) — don't mark this step done until
    // the Worker is actually reachable, or the very next thing the student does
    // (upload a resume) can fail with an opaque network error.
    await cloudflare.waitForWorkerReachable(workerUrl);

    const latestMeta = await getMeta(cfConnection.id);
    await saveMeta(cfConnection.id, { ...latestMeta, accountId, kvNamespaceId, workerUrl, workerScriptName: scriptName });
    await updateStep(userId, "cloudflare_worker", "done");
    await prisma.connection.update({ where: { id: cfConnection.id }, data: { status: "CONNECTED", lastError: null } });
  } catch (err) {
    await failStep(userId, cfConnection.id, currentActiveStep(await getProvisioningStatus(userId)), err);
    throw err;
  }
}

/**
 * The Worker deploy needs the Supabase service-role key, so if a student connects
 * Cloudflare before Supabase finishes provisioning (a real race — both cards can be
 * started independently per the UI), wait for Supabase to reach CONNECTED first
 * rather than failing outright. Bounded so a genuinely broken Supabase connection
 * still surfaces as an error instead of hanging forever.
 */
export async function provisionCloudflareWhenReady(userId: string, timeoutMs = 5 * 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const supabase = await prisma.connection.findUniqueOrThrow({
      where: { userId_provider: { userId, provider: "SUPABASE" } },
    });
    if (supabase.status === "CONNECTED") break;
    if (supabase.status === "ERROR") {
      throw new Error("Cloudflare provisioning can't proceed: the Supabase connection is in an error state");
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for Supabase provisioning to finish before deploying the Worker");
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  await provisionCloudflare(userId);
}

async function pickFirstAccount(bearerToken: string): Promise<string> {
  const accounts = await cloudflare.listAccounts(bearerToken);
  const first = accounts[0];
  if (!first) throw new Error("Cloudflare token has no accessible accounts");
  return first.id;
}

function currentActiveStep(steps: ProvisioningStep[]): string {
  return steps.find((s) => s.state === "active")?.key ?? steps[0]!.key;
}

async function failStep(userId: string, connectionId: string, stepKey: string, err: unknown) {
  await updateStep(userId, stepKey, "error");
  // Deliberately never store the raw exception message here. `lastError` is read
  // back by GET /api/provisioning/status and shown in the UI — but the errors
  // this catches come from deployWorker/createProject/exchangeCodeForToken, whose
  // failure responses embed the third-party API's raw body. Those requests carry
  // real secrets (the Supabase service-role key as a Worker binding, this
  // platform's own OAuth client secret, a freshly generated DB password) — if a
  // provider's error response ever echoes back what we sent, that secret would
  // otherwise flow: thrown Error -> here -> lastError -> the browser. Log the full
  // error server-side (where it's actually needed to debug a failed deploy);
  // surface only a fixed, per-step-safe message to anything client-reachable.
  console.error(`provisioning step "${stepKey}" failed for user ${userId}:`, err);
  await prisma.connection.update({
    where: { id: connectionId },
    data: { status: "ERROR", lastError: `Setup failed at step "${stepKey}". Try reconnecting — if it keeps failing, contact support.` },
  });
}

async function getMeta(connectionId: string): Promise<Record<string, unknown>> {
  const c = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
  return (c.metadataJson as Record<string, unknown> | null) ?? {};
}

async function saveMeta(connectionId: string, meta: Record<string, unknown>) {
  await prisma.connection.update({ where: { id: connectionId }, data: { metadataJson: meta as unknown as object } });
}
