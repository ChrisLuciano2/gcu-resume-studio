// Calls into a student's own deployed Cloudflare Worker. The central app never
// calls Workers AI directly — every AI call runs on the student's own account via
// their Worker's AI binding, per PLAN.md.

export interface EmbedResponse {
  ok: boolean;
  embeddings?: number[][];
  reason?: string;
}

export async function embedTexts(workerUrl: string, texts: string[]): Promise<EmbedResponse> {
  return callWorker(workerUrl, "/embed", { texts }, 25_000);
}

export interface TailorResponse {
  ok: boolean;
  plan?: Array<{ id: string; bullets: string[]; tags: string[] }>;
  reason?: string;
}

export async function tailorChunks(
  workerUrl: string,
  chunks: unknown[],
  targetField: string,
  jobDescription?: string,
): Promise<TailorResponse> {
  // The Worker retries internally up to 2x against its own 40s-per-attempt
  // budget (worker-template/src/index.js's TAILOR_TIMEOUT_MS and MAX_ATTEMPTS)
  // on both a malformed JSON Mode response and a slow/timed-out one — both
  // confirmed live as real, non-hypothetical failure modes for this model. This
  // client-side timeout must comfortably exceed that worst case (~80s), or we'd
  // abort a retry sequence that was about to succeed.
  return callWorker(workerUrl, "/tailor", { chunks, targetField, jobDescription }, 100_000);
}

export interface CoverLetterResponse {
  ok: boolean;
  letter?: string;
  reason?: string;
}

export async function generateCoverLetter(
  workerUrl: string,
  chunks: unknown[],
  header: string | undefined,
  targetField: string | undefined,
  jobDescription?: string,
): Promise<CoverLetterResponse> {
  // Worst case bounded the same way as /tailor: MAX_ATTEMPTS (2) retries at
  // COVER_LETTER_TIMEOUT_MS (30s) each in worker-template/src/index.js — this
  // client-side timeout must comfortably exceed that ~60s worst case.
  return callWorker(workerUrl, "/cover-letter", { chunks, header, targetField, jobDescription }, 80_000);
}

async function callWorker<T>(workerUrl: string, path: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(`${workerUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // Belt-and-suspenders alongside the Worker's own internal AI timeout: never
    // let a hung Worker request hang the editor's generating state forever.
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((err) => {
    throw new WorkerCallError(err instanceof Error ? err.message : String(err));
  });

  // Deliberately not gating on res.ok here: the Worker's /embed and /tailor
  // contract (worker-template/src/index.js) is to always return a JSON body with
  // an `ok` field, using the HTTP status as informational metadata, not as the
  // signal — a timeout is `{ ok: false, reason: "timeout" }` on a 504, an
  // unparseable AI response is `{ ok: false, reason: "unparseable_ai_response" }`
  // on a 502. Throwing here on any non-2xx (as this used to) discarded that body
  // before the caller's own `if (!result.ok)` handling ever ran, turning a
  // well-understood application-level failure into an opaque generic error.
  // Only a response that isn't valid JSON at all — a genuinely unexpected shape —
  // should become a WorkerCallError.
  try {
    return await res.json();
  } catch {
    throw new WorkerCallError(`worker returned a non-JSON response (status ${res.status})`);
  }
}

export class WorkerCallError extends Error {}
