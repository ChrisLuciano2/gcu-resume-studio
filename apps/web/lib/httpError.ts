// For API calls whose *request* carries a real secret (a service-role key, this
// platform's own OAuth client secret, a freshly generated DB password), never pull
// the failure response's raw body into an Error message or a log line — some APIs
// echo back parts of a rejected request in their validation errors, and that body
// would otherwise flow: fetch response -> Error.message -> a catch block several
// layers up -> console.error or (see lib/provisioning/orchestrator.ts's failStep)
// a client-visible field, before anyone downstream gets a chance to redact it.
//
// Use this instead of `` `failed: ${res.status} ${await res.text()}` `` for any
// call site whose request body/headers included one of those secrets. For calls
// whose request carries nothing sensitive (e.g. lib/cloudflare.ts's cfFetch),
// logging the body is fine and more useful for debugging — this helper is only
// for the sensitive subset.
export async function secretSafeHttpError(label: string, res: Response): Promise<Error> {
  // Status code alone is not sensitive and is what's actually useful to log/return
  // here — the response body is discarded unread, on purpose, not just unlogged.
  return new Error(`${label} failed with status ${res.status}`);
}
