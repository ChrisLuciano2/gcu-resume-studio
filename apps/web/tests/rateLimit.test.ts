import { describe, expect, it } from "vitest";
import { checkRateLimit } from "@/lib/rateLimit";

describe("rateLimit: fixed-window limiter for public routes", () => {
  it("allows requests under the limit and blocks once it's hit", () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60_000)).toBe(true);
    }
    expect(checkRateLimit(key, 5, 60_000)).toBe(false);
  });

  it("tracks separate keys independently", () => {
    const a = `test:a:${Math.random()}`;
    const b = `test:b:${Math.random()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(a, 3, 60_000);
    expect(checkRateLimit(a, 3, 60_000)).toBe(false);
    expect(checkRateLimit(b, 3, 60_000)).toBe(true);
  });

  it("resets the count once the window elapses", async () => {
    const key = `test:window:${Math.random()}`;
    expect(checkRateLimit(key, 1, 10)).toBe(true);
    expect(checkRateLimit(key, 1, 10)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(checkRateLimit(key, 1, 10)).toBe(true);
  });
});
