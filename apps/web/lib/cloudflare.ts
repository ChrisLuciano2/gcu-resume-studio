import { randomBytes } from "node:crypto";
import { secretSafeHttpError } from "./httpError";

// Cloudflare API client: self-managed OAuth (primary) + pasted-token (fallback),
// KV namespace creation, and Worker deployment with the secret_text/plain_text
// binding distinction called out in PLAN.md. Docs:
// https://developers.cloudflare.com/changelog/post/2026-06-03-public-oauth-clients/
// https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/

const AUTHORIZE_URL = "https://dash.cloudflare.com/oauth2/authorize";
const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
const API_BASE = "https://api.cloudflare.com/client/v4";

// Verified against the live "create OAuth client" wizard (Manage account > OAuth
// clients) on 2026-09-16 — the wizard's own scope picker lists these four exact
// permissions (as "Workers Scripts Write", "Workers KV Storage Write", "Account
// Settings Read", "User Details Read") as what's needed for: deploying/updating a
// student's Worker, creating their KV namespace, listing their accounts, and
// reading their account-holder identity. The dashboard shows display names, not
// the raw `scope` query-param strings the authorize URL needs — these dot-notation
// slugs match the pattern Cloudflare's own OAuth changelog used for two of the
// four (workers-scripts.write, workers-kv-storage.write); "account-settings.read"
// is inferred from the matching category name rather than independently
// confirmed. If the OAuth authorize redirect ever comes back with an invalid_scope
// error, this is the first thing to re-check.
//
// D1 scope resolved 2026-09-17: the previous four scopes got a 401 "Authentication
// error" on every D1 endpoint, and no doc page published the slug D1 needed. Rather
// than guess (wrong would break every student's OAuth connection with
// invalid_scope), confirmed it directly against Cloudflare's own
// GET /api/v4/oauth/scopes response while signed into the live dashboard: D1's
// scopes are "d1.read", "d1.write", "d1.metadata_read" — same dot-notation
// convention as the other four, "D1 Write" display name matching the "D1:Edit"
// token permission the pasted-token fallback path already uses (see
// connect/page.tsx and verifyToken below). Added d1.write here to match, and
// added "D1 Write" to the live CLOUDFLARE_OAUTH_CLIENT_ID client's own scope
// list on Cloudflare's dashboard the same day (5 scopes now, was 4) — both
// sides have to agree or the authorize request 400s with invalid_scope. Not
// yet re-verified that a full OAuth connect run reaches D1 without a 401 end
// to end; the four-scope 401 that started this was confirmed live, this fix
// wasn't re-tested against a real authorize/token/D1-call round trip yet.
export const CLOUDFLARE_OAUTH_SCOPES = [
  "user-details.read",
  "account-settings.read",
  "workers-scripts.write",
  "workers-kv-storage.write",
  "d1.write",
] as const;

export function generatePkceVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export async function pkceChallengeFromVerifier(verifier: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizeUrl(opts: { state: string; codeChallenge: string }): string {
  const clientId = requireEnv("CLOUDFLARE_OAUTH_CLIENT_ID");
  const redirectUri = requireEnv("CLOUDFLARE_OAUTH_REDIRECT_URI");
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CLOUDFLARE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface CloudflareTokenResponse {
  access_token: string;
  // Confirmed against a live token exchange on 2026-09-16: Cloudflare's response
  // does not always include a refresh_token (unlike Supabase's, which does) — this
  // was previously typed as required and crashed encryptSecret() with "undefined"
  // the first time this flow ran for real. Provisioning only needs access_token
  // (it's a one-shot operation, not a long-lived session), so treat this as
  // optional everywhere it's stored rather than assuming it exists.
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<CloudflareTokenResponse> {
  const clientId = requireEnv("CLOUDFLARE_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("CLOUDFLARE_OAUTH_CLIENT_SECRET");
  const redirectUri = requireEnv("CLOUDFLARE_OAUTH_REDIRECT_URI");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    // This request carries this platform's own OAuth client_secret in the body —
    // a leak here is worse than a per-student leak, it compromises the whole app's
    // Cloudflare OAuth registration. secretSafeHttpError, never raw res.text().
    throw await secretSafeHttpError("Cloudflare token exchange", res);
  }
  return res.json();
}

/** Validates a pasted API token (fallback path) and returns its account-scoped id. */
export async function verifyToken(token: string): Promise<{ valid: boolean; status: string }> {
  const res = await fetch(`${API_BASE}/user/tokens/verify`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  return { valid: res.ok && body.success, status: body.result?.status ?? "unknown" };
}

export async function listAccounts(bearerToken: string): Promise<Array<{ id: string; name: string }>> {
  const res = await cfFetch(bearerToken, "/accounts");
  return res.result;
}

export async function createKvNamespace(
  bearerToken: string,
  accountId: string,
  title: string,
): Promise<{ id: string }> {
  const res = await cfFetch(bearerToken, `/accounts/${accountId}/storage/kv/namespaces`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  return res.result;
}

export async function createD1Database(
  bearerToken: string,
  accountId: string,
  name: string,
): Promise<{ uuid: string }> {
  const res = await cfFetch(bearerToken, `/accounts/${accountId}/d1/database`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return res.result;
}

export interface D1QueryResult<T> {
  results: T[];
}

/**
 * Runs one SQL statement against a student's D1 database. One statement per
 * call — confirmed live 2026-09-16 this is how the API is meant to be used
 * (each call's `result` is a single-element array, one entry per statement
 * sent). Always parameterized (`params`, `?` placeholders) — never build SQL
 * by interpolating a caller-supplied string, the whole point of this helper
 * existing is to not repeat that mistake at each of the ~9 call sites that
 * used to build PostgREST path strings by hand.
 */
export async function d1Query<T = unknown>(
  bearerToken: string,
  accountId: string,
  databaseId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await fetch(`${API_BASE}/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) {
    // Confirmed live: a bad statement's error body is just { code, message } —
    // no secret ever appears in a D1 query error, since the query text is SQL
    // this app wrote, not third-party-echoed request data. Safe to include here.
    throw new Error(`D1 query failed: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  }
  const result = body.result?.[0] as D1QueryResult<T> | undefined;
  return result?.results ?? [];
}

/**
 * Idempotently adds a column to an already-provisioned student's D1 database.
 * Needed because `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` in SQLite
 * (unlike `CREATE TABLE IF NOT EXISTS`, which every schema.sql statement uses)
 * — re-running a bare ALTER against a database that already has the column
 * throws "duplicate column name". The orchestrator's schema step reruns on
 * every `provisionCloudflare` call, including a reconnect of an
 * already-provisioned student, so a schema change added after some students
 * already exist needs this rather than a raw ALTER in schema.sql.
 */
export async function ensureColumn(
  bearerToken: string,
  accountId: string,
  databaseId: string,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const columns = await d1Query<{ name: string }>(bearerToken, accountId, databaseId, `PRAGMA table_info(${table})`);
  if (columns.some((c) => c.name === column)) return;
  await d1Query(bearerToken, accountId, databaseId, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export interface WorkerDeployParams {
  bearerToken: string;
  accountId: string;
  scriptName: string;
  moduleSource: string; // the Worker's compiled/bundled JS
  kvNamespaceId: string;
  databaseId: string; // D1 database this Worker's DB binding points at
  dailyChatBudget: number;
}

/**
 * Deploys the Worker template via a multipart module upload. Bindings: Workers AI,
 * the per-student KV namespace (chat rate-limit/cache counters), and the
 * per-student D1 database (resumes/drafts/chat_cache — see
 * lib/provisioning/schema.sql). Unlike the Supabase-era version of this function,
 * there's no secret_text binding here at all: D1/KV access from inside the Worker
 * is authorized by the binding itself, not a credential the Worker code has to
 * hold — nothing here is sensitive enough to need secretSafeHttpError's redaction,
 * though the failure path below still doesn't echo the raw response body, since a
 * validation-error response could in principle echo back the module source.
 */
export async function deployWorker(params: WorkerDeployParams): Promise<void> {
  const metadata = {
    main_module: "index.js",
    compatibility_date: "2026-01-01",
    bindings: [
      { type: "ai", name: "AI" },
      { type: "kv_namespace", name: "CHAT_KV", namespace_id: params.kvNamespaceId },
      { type: "d1", name: "DB", database_id: params.databaseId },
      { type: "plain_text", name: "DAILY_CHAT_BUDGET", text: String(params.dailyChatBudget) },
    ],
  };

  const form = new FormData();
  form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.set("index.js", new Blob([params.moduleSource], { type: "application/javascript+module" }), "index.js");

  const res = await fetch(`${API_BASE}/accounts/${params.accountId}/workers/scripts/${params.scriptName}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${params.bearerToken}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Cloudflare Worker deploy failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Enables (or reads back) the script's workers.dev subdomain route.
 *
 * Confirmed live on 2026-09-16: a Cloudflare account that has never used Workers
 * before has NO account-level workers.dev subdomain yet — GET .../workers/subdomain
 * 404s with "You do not have a workers.dev subdomain" until one is created. The
 * Cloudflare dashboard's own onboarding creates one automatically the first time
 * you open Workers & Pages, which masked this for accounts (like whoever wrote
 * this code) that had already done that manually. A brand-new GCU student's
 * Cloudflare account will not have — this is expected to be the common case here,
 * not an edge case, so create one via PUT rather than just erroring out.
 */
export async function enableWorkersDevRoute(
  bearerToken: string,
  accountId: string,
  scriptName: string,
): Promise<string> {
  await cfFetch(bearerToken, `/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`, {
    method: "POST",
    body: JSON.stringify({ enabled: true }),
  });

  const accountSubdomain = await getOrCreateAccountSubdomain(bearerToken, accountId);
  return `https://${scriptName}.${accountSubdomain}.workers.dev`;
}

/**
 * Confirmed live on 2026-09-16: a workers.dev subdomain that was just created (see
 * getOrCreateAccountSubdomain) isn't immediately resolvable — the first request to
 * it fails at the DNS/connect level (fetch throws, not an HTTP error status) for
 * roughly a minute after creation. A student who connects Cloudflare and
 * immediately uploads a resume would hit this exact race in the ingestion route's
 * call to the Worker's /embed endpoint. Poll here, as part of provisioning, so
 * "cloudflare_worker: done" actually means the Worker is reachable, not just that
 * the deploy API call succeeded.
 */
export async function waitForWorkerReachable(
  workerUrl: string,
  { timeoutMs = 90_000, intervalMs = 3_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      // Any response at all (even a 404/405 for the wrong method) proves DNS
      // resolved and the Worker is serving — GET isn't a route this Worker
      // handles, so a reachable-but-405-shaped reply is the expected success case.
      await fetch(workerUrl, { method: "GET", signal: AbortSignal.timeout(5_000) });
      return;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`Worker at ${workerUrl} did not become reachable within ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

async function getOrCreateAccountSubdomain(bearerToken: string, accountId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/accounts/${accountId}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  if (res.ok) {
    const body = await res.json();
    return body.result.subdomain as string;
  }

  // No subdomain registered yet — account_id is already globally unique (and
  // lowercase hex, satisfying workers.dev's naming rules), so derive the
  // subdomain from it rather than trying to invent a human-readable name that
  // might collide with another Cloudflare customer's account.
  const subdomain = `rs-${accountId.slice(0, 20)}`;
  const created = await cfFetch(bearerToken, `/accounts/${accountId}/workers/subdomain`, {
    method: "PUT",
    body: JSON.stringify({ subdomain }),
  });
  return created.result.subdomain as string;
}

async function cfFetch(bearerToken: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json();
  if (!res.ok || body.success === false) {
    throw new Error(`Cloudflare API ${path} failed: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  }
  return body;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
