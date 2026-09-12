// Eagerly validates required secrets. Called from instrumentation.ts at process
// startup (see below) so a missing or malformed MASTER_KEY fails loudly before the
// server accepts any traffic — not lazily, on whichever request first happens to
// touch encryption. There is no fallback branch here on purpose: a key that fails
// validation must stop the process, never degrade to something weaker.

export function validateEnv(): void {
  decodeMasterKey(requireEnv("MASTER_KEY"));
  requireEnv("SESSION_SECRET");
  requireEnv("DATABASE_URL");
}

/** Shared by lib/crypto.ts so the "what counts as a valid key" rule lives in one place. */
export function decodeMasterKey(raw: string): Buffer {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch {
    throw new Error("MASTER_KEY is not valid base64. Refusing to start.");
  }
  if (decoded.length !== 32) {
    throw new Error(
      `MASTER_KEY must decode to 32 bytes for AES-256-GCM, got ${decoded.length}. ` +
        "Generate with: openssl rand -base64 32. Refusing to start.",
    );
  }
  return decoded;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set. Refusing to start.`);
  }
  return v;
}
