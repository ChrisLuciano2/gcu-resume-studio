// Calls into a student's own deployed Cloudflare Worker. The central app never
// calls Workers AI directly — every AI call runs on the student's own account via
// their Worker's AI binding, per PLAN.md.

export interface EmbedResponse {
  ok: boolean;
  embeddings?: number[][];
  reason?: string;
}

export async function embedTexts(workerUrl: string, texts: string[]): Promise<EmbedResponse> {
  return callWorker(workerUrl, "/embed", { texts });
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
): Promise<TailorResponse> {
  return callWorker(workerUrl, "/tailor", { chunks, targetField });
}

async function callWorker<T>(workerUrl: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${workerUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // Belt-and-suspenders alongside the Worker's own internal AI timeout: never
    // let a hung Worker request hang the editor's generating state forever.
    signal: AbortSignal.timeout(25_000),
  }).catch((err) => {
    throw new WorkerCallError(err instanceof Error ? err.message : String(err));
  });

  if (!res.ok) {
    throw new WorkerCallError(`worker responded ${res.status}`);
  }
  return res.json();
}

export class WorkerCallError extends Error {}
