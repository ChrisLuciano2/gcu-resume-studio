// Next.js instrumentation hook — runs once when the server process starts, before
// it accepts any requests. This is what makes env validation actually happen "at
// startup" rather than lazily on whichever request first touches encryption; see
// lib/env.ts. Requires experimental.instrumentationHook in next.config.mjs on
// Next.js 14.x (stable by default in 15+).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("./lib/env");
    validateEnv();
  }
}
