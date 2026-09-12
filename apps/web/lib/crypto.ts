import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { decodeMasterKey } from "./env";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

// AES-256-GCM at-rest encryption for OAuth tokens and the Supabase service-role key
// held in the central DB. MASTER_KEY must be a 32-byte key, base64-encoded.
// Format on disk: base64(iv) + "." + base64(authTag) + "." + base64(ciphertext)
//
// This also gets validated eagerly at process startup (see instrumentation.ts +
// lib/env.ts) so a missing/malformed key fails loudly before the server accepts
// traffic. getMasterKey() re-validates per call rather than caching, on purpose:
// no in-memory shortcut that could let a bad key slip past in a code path that
// forgot to import instrumentation.ts (e.g. a standalone script or test runner).

function getMasterKey(): Buffer {
  const raw = process.env.MASTER_KEY;
  if (!raw) throw new Error("MASTER_KEY is not set");
  return decodeMasterKey(raw);
}

export function encryptSecret(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptSecret(encoded: string): string {
  const key = getMasterKey();
  const parts = encoded.split(".");
  if (parts.length !== 3) throw new Error("malformed encrypted payload");
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
