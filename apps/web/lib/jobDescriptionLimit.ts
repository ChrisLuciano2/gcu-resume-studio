// Split out from lib/drafts.ts on purpose: drafts.ts imports `randomUUID` from
// "node:crypto" (server-only), and this constant needs to be importable from
// the client-side editor page too — a mixed value+type import from drafts.ts
// forces webpack to bundle its whole module graph into the client bundle,
// which then fails on the Node-only import. This file has zero dependencies
// so it's safe on both sides of that boundary.
//
// A pasted job posting is unbounded free text from an authenticated user,
// unlike the fixed category/niche labels — cap it well above any real
// posting's length but well below anything that would blow the tailoring
// model's context or cost. worker-template/src/index.js enforces the same
// number independently (it's a dependency-free, standalone-deployed file with
// no shared module to import this constant from) as defense-in-depth, since
// it's technically callable directly.
export const MAX_JOB_DESCRIPTION_LENGTH = 6000;
