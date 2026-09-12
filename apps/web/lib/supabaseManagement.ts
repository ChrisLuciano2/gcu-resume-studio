import { randomBytes } from "node:crypto";

// Thin client for the Supabase Management API's OAuth + project-provisioning
// endpoints. See PLAN.md "OAuth + provisioning flows" for the sequence this
// supports. Docs: https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration

const AUTHORIZE_URL = "https://api.supabase.com/v1/oauth/authorize";
const TOKEN_URL = "https://api.supabase.com/v1/oauth/token";
const API_BASE = "https://api.supabase.com/v1";

export function generatePkcePair() {
  // S256 PKCE, per Supabase's recommendation.
  const verifier = randomBytes(32).toString("base64url");
  return { verifier };
}

export async function pkceChallengeFromVerifier(verifier: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizeUrl(opts: { state: string; codeChallenge: string }): string {
  const clientId = requireEnv("SUPABASE_OAUTH_CLIENT_ID");
  const redirectUri = requireEnv("SUPABASE_OAUTH_REDIRECT_URI");
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface SupabaseTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<SupabaseTokenResponse> {
  const clientId = requireEnv("SUPABASE_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("SUPABASE_OAUTH_CLIENT_SECRET");
  const redirectUri = requireEnv("SUPABASE_OAUTH_REDIRECT_URI");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Supabase token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export interface SupabaseProject {
  id: string; // project ref
  name: string;
  status: string; // e.g. "ACTIVE_HEALTHY", "COMING_UP"
  database?: { host: string };
}

export async function createProject(accessToken: string, name: string): Promise<SupabaseProject> {
  const orgId = requireEnv("SUPABASE_ORG_ID");
  const dbPass = randomBytes(24).toString("base64url");
  const res = await fetch(`${API_BASE}/projects`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      organization_id: orgId,
      db_pass: dbPass,
      region: "us-east-1",
      plan: "free",
    }),
  });
  if (!res.ok) {
    throw new Error(`Supabase project creation failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function getProject(accessToken: string, ref: string): Promise<SupabaseProject> {
  const res = await fetch(`${API_BASE}/projects/${ref}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Supabase get project failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Poll until the project reports ACTIVE_HEALTHY, or throw after timeoutMs. */
export async function waitUntilActive(
  accessToken: string,
  ref: string,
  { timeoutMs = 5 * 60_000, intervalMs = 5_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<SupabaseProject> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const project = await getProject(accessToken, ref);
    if (project.status === "ACTIVE_HEALTHY") return project;
    if (Date.now() > deadline) {
      throw new Error(`Supabase project ${ref} did not become active within ${timeoutMs}ms (last status: ${project.status})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function runQuery(accessToken: string, ref: string, query: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`Supabase run query failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** API keys (anon + service_role) for a project, fetched post-creation. */
export async function getApiKeys(
  accessToken: string,
  ref: string,
): Promise<{ anonKey: string; serviceRoleKey: string }> {
  const res = await fetch(`${API_BASE}/projects/${ref}/api-keys`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Supabase get api keys failed: ${res.status} ${await res.text()}`);
  }
  const keys: Array<{ name: string; api_key: string }> = await res.json();
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  const service = keys.find((k) => k.name === "service_role")?.api_key;
  if (!anon || !service) throw new Error("Supabase project is missing anon/service_role keys");
  return { anonKey: anon, serviceRoleKey: service };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
