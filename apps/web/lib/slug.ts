import { randomBytes } from "node:crypto";

export function makeSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  // 16 bytes (128 bits) — a public route (app/api/r/[slug]) resolves this straight
  // to a student's resume with no auth, so the suffix is the only thing standing
  // between a scanner and PII. 3 bytes (24 bits, ~16.7M values) was brute-forceable
  // against a predictable base like "default-resume-"; 128 bits is not.
  const suffix = randomBytes(16).toString("hex");
  return base ? `${base}-${suffix}` : suffix;
}
