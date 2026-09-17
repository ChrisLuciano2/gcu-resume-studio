/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth", "@prisma/client"],
    // Enables instrumentation.ts's register() hook (stable by default in Next 15+;
    // still behind this flag on 14.x) — see instrumentation.ts and lib/env.ts for
    // why: it's how MASTER_KEY gets validated at process startup, not lazily.
    instrumentationHook: true,
    // lib/provisioning/orchestrator.ts does `readFileSync(join(process.cwd(), "..",
    // "..", "worker-template", "src", "index.js"))` at module load — the Worker
    // source it deploys per student lives outside apps/web entirely (this repo has
    // no root package.json/workspace config, so nothing about this directory layout
    // tells Next's build-time file tracer that file exists). Without this, a
    // serverless deploy (Vercel or similar) would silently omit index.js from the
    // function bundle and every provisioning-dependent route would throw at cold
    // start in production despite working fine in local dev, where the whole repo
    // is just sitting on disk. Explicit per-route includes for every route that
    // imports the orchestrator (transitively, in provisionCloudflare's case).
    outputFileTracingIncludes: {
      "/api/connections/cloudflare/callback": ["../../worker-template/src/index.js"],
      "/api/connections/cloudflare/token": ["../../worker-template/src/index.js"],
      "/api/provisioning/status": ["../../worker-template/src/index.js"],
    },
  },
};

export default nextConfig;
