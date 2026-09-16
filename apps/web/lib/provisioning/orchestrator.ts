import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../db";
import { decryptSecret } from "../crypto";
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
  { key: "cloudflare_d1", label: "Create D1 database" },
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
 * The whole provisioning path now lives on one provider — see PLAN.md for why
 * D1 replaced per-student Supabase. Safe to call again after a partial
 * failure: each step re-checks whether its work is already done via the
 * Connection row's metadata before doing it again, and every CREATE TABLE in
 * schema.sql is IF NOT EXISTS, so re-running the schema step against an
 * already-provisioned database is a no-op, not an error.
 */
export async function provisionCloudflare(userId: string): Promise<void> {
  await getOrInitRun(userId);
  const connection = await prisma.connection.findUniqueOrThrow({
    where: { userId_provider: { userId, provider: "CLOUDFLARE" } },
  });

  const bearerToken = connection.encryptedAccessToken
    ? decryptSecret(connection.encryptedAccessToken)
    : connection.encryptedApiToken
      ? decryptSecret(connection.encryptedApiToken)
      : (() => {
          throw new Error("Cloudflare connection has no usable token");
        })();

  await prisma.connection.update({ where: { id: connection.id }, data: { status: "CONNECTING" } });

  try {
    const meta = (connection.metadataJson as Record<string, unknown> | null) ?? {};
    const accountId = (meta.accountId as string) ?? (await pickFirstAccount(bearerToken));

    await updateStep(userId, "cloudflare_d1", "active");
    let databaseId = meta.databaseId as string | undefined;
    if (!databaseId) {
      const db = await cloudflare.createD1Database(bearerToken, accountId, `resume-studio-${userId.slice(0, 8)}`);
      databaseId = db.uuid;
      await saveMeta(connection.id, { ...meta, accountId, databaseId });
    }
    for (const statement of splitSqlStatements(SCHEMA_SQL)) {
      await cloudflare.d1Query(bearerToken, accountId, databaseId, statement);
    }
    // Backfills columns added after some students' databases already existed —
    // see lib/cloudflare.ts's ensureColumn for why this can't just be another
    // statement in schema.sql (CREATE TABLE IF NOT EXISTS can't add a column
    // to a table that's already there, and a bare ALTER TABLE isn't safe to
    // rerun). Add future new-column migrations here the same way.
    await cloudflare.ensureColumn(bearerToken, accountId, databaseId, "drafts", "job_description", "TEXT");
    await cloudflare.ensureColumn(bearerToken, accountId, databaseId, "drafts", "cover_letter", "TEXT");
    await updateStep(userId, "cloudflare_d1", "done");

    await updateStep(userId, "cloudflare_kv", "active");
    const latestMeta1 = await getMeta(connection.id);
    let kvNamespaceId = latestMeta1.kvNamespaceId as string | undefined;
    if (!kvNamespaceId) {
      const ns = await cloudflare.createKvNamespace(bearerToken, accountId, `resume-studio-${userId.slice(0, 8)}`);
      kvNamespaceId = ns.id;
      await saveMeta(connection.id, { ...latestMeta1, accountId, kvNamespaceId });
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
      databaseId,
      dailyChatBudget: 20,
    });
    const workerUrl = await cloudflare.enableWorkersDevRoute(bearerToken, accountId, scriptName);
    // A freshly created workers.dev subdomain isn't immediately resolvable (real
    // DNS propagation delay, confirmed live) — don't mark this step done until
    // the Worker is actually reachable, or the very next thing the student does
    // (upload a resume) can fail with an opaque network error.
    await cloudflare.waitForWorkerReachable(workerUrl);

    const latestMeta2 = await getMeta(connection.id);
    await saveMeta(connection.id, { ...latestMeta2, accountId, databaseId, kvNamespaceId, workerUrl, workerScriptName: scriptName });
    await updateStep(userId, "cloudflare_worker", "done");
    await prisma.connection.update({ where: { id: connection.id }, data: { status: "CONNECTED", lastError: null } });
  } catch (err) {
    await failStep(userId, connection.id, currentActiveStep(await getProvisioningStatus(userId)), err);
    throw err;
  }
}

/** D1's query API takes one statement per call — split on `;` at statement
 *  boundaries, dropping comments and blank lines. schema.sql's statements
 *  never contain a literal `;` inside a string, so a plain split is safe. */
function splitSqlStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
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
  // Deliberately never store the raw exception message here — see
  // lib/httpError.ts's reasoning; a provider's error response could echo back
  // something from the request. Log the full error server-side; surface only a
  // fixed, per-step-safe message to anything client-reachable.
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
