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
export const CLOUDFLARE_OAUTH_SCOPES = [
  "user-details.read",
  "account-settings.read",
  "workers-scripts.write",
  "workers-kv-storage.write",
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
  refresh_token: string;
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

export interface WorkerDeployParams {
  bearerToken: string;
  accountId: string;
  scriptName: string;
  moduleSource: string; // the Worker's compiled/bundled JS
  kvNamespaceId: string;
  /** Public, non-sensitive — bound as plain_text. */
  supabaseUrl: string;
  /** Bypasses row-level security — MUST be bound as secret_text, never plain_text. */
  supabaseServiceKey: string;
  dailyChatBudget: number;
}

/**
 * Deploys the Worker template via a multipart module upload. The critical detail
 * (see PLAN.md): SUPABASE_URL is a plain_text binding (just a public project URL),
 * but SUPABASE_SERVICE_KEY is a secret_text binding — Cloudflare stores it encrypted
 * and never echoes it back on subsequent reads, unlike a plain_text var which is
 * visible in the dashboard and in GET responses on the script's bindings.
 */
export async function deployWorker(params: WorkerDeployParams): Promise<void> {
  const metadata = {
    main_module: "index.js",
    compatibility_date: "2026-01-01",
    bindings: [
      { type: "ai", name: "AI" },
      { type: "kv_namespace", name: "CHAT_KV", namespace_id: params.kvNamespaceId },
      { type: "plain_text", name: "SUPABASE_URL", text: params.supabaseUrl },
      { type: "secret_text", name: "SUPABASE_SERVICE_KEY", text: params.supabaseServiceKey },
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
    // secretSafeHttpError, not `${res.status} ${await res.text()}` — this request's
    // metadata includes the student's Supabase service-role key as a secret_text
    // binding value; a validation-error body that happened to echo it back must
    // never enter this Error's message. See lib/httpError.ts.
    throw await secretSafeHttpError("Cloudflare Worker deploy", res);
  }
}

/** Enables (or reads back) the script's workers.dev subdomain route. */
export async function enableWorkersDevRoute(
  bearerToken: string,
  accountId: string,
  scriptName: string,
): Promise<string> {
  await cfFetch(bearerToken, `/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`, {
    method: "POST",
    body: JSON.stringify({ enabled: true }),
  });
  const subdomainRes = await cfFetch(bearerToken, `/accounts/${accountId}/workers/subdomain`);
  const accountSubdomain = subdomainRes.result.subdomain as string;
  return `https://${scriptName}.${accountSubdomain}.workers.dev`;
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
