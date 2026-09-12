import { describe, expect, it, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

describe("crypto: AES-256-GCM secret round-trip", () => {
  beforeAll(() => {
    process.env.MASTER_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips a plaintext secret", () => {
    const plaintext = "sb_service_role_super_secret_key_12345";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b);
  });

  it("rejects a tampered ciphertext instead of silently returning garbage", () => {
    const encrypted = encryptSecret("sensitive-token");
    const parts = encrypted.split(".");
    const tampered = [parts[0], parts[1], Buffer.from("tampered-payload").toString("base64")].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws a clear error when MASTER_KEY is missing rather than encrypting insecurely", () => {
    const saved = process.env.MASTER_KEY;
    delete process.env.MASTER_KEY;
    expect(() => encryptSecret("x")).toThrow(/MASTER_KEY/);
    process.env.MASTER_KEY = saved;
  });
});
