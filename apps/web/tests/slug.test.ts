import { describe, expect, it } from "vitest";
import { makeSlug } from "@/lib/slug";

describe("slug: public-route access token", () => {
  it("has a 128-bit random suffix, not the old brute-forceable 24-bit one", () => {
    const slug = makeSlug("Default resume");
    const suffix = slug.split("-").pop()!;
    expect(suffix).toHaveLength(32); // 16 bytes as hex
  });

  it("never repeats across many calls with the same base name", () => {
    const slugs = new Set(Array.from({ length: 1000 }, () => makeSlug("Default resume")));
    expect(slugs.size).toBe(1000);
  });

  it("falls back to a bare random slug for a name with no usable characters", () => {
    const slug = makeSlug("!!!");
    expect(slug).toMatch(/^[0-9a-f]{32}$/);
  });
});
