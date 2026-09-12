// Direct PostgREST access to a student's own Supabase project, using their
// service-role key (decrypted server-side only, never sent to the browser).
// Used by the orchestrator's ingestion/draft routes; the deployed Worker talks to
// the same REST API independently for /chat (see worker-template/src/index.js).

export interface StudentSupabase {
  projectUrl: string;
  serviceRoleKey: string;
}

export async function studentRest<T>(
  client: StudentSupabase,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${client.projectUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: client.serviceRoleKey,
      Authorization: `Bearer ${client.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase REST ${path} failed: ${res.status} ${await res.text()}`);
  }
  // PostgREST returns an empty body for some writes even with Prefer: return=representation
  // omitted; guard against JSON parse of an empty string.
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export function withReturnRepresentation(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...init.headers, Prefer: "return=representation" } };
}
