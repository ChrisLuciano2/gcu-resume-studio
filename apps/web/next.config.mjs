/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth", "@prisma/client"],
    // Enables instrumentation.ts's register() hook (stable by default in Next 15+;
    // still behind this flag on 14.x) — see instrumentation.ts and lib/env.ts for
    // why: it's how MASTER_KEY gets validated at process startup, not lazily.
    instrumentationHook: true,
  },
};

export default nextConfig;
