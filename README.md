# GCU Resume Studio — backend

Bring-your-own-infra resume tailoring tool: each student connects their own Supabase
project (data) and Cloudflare account (compute + Workers AI), so no student's chatbot
usage is capped by another student's traffic.

See [`PLAN.md`](./PLAN.md) for the full architecture writeup (data model, OAuth flows,
provisioning sequence, Worker responsibilities).

## Layout

- `apps/web` — the central Next.js orchestrator: student auth, OAuth + provisioning
  against the Supabase Management API and Cloudflare API, the resume editor / bank /
  connect-accounts UI, and the public `/r/[slug]` recruiter-facing router.
- `worker-template` — the Cloudflare Worker source deployed into each student's own
  account. Exposes `/embed`, `/tailor`, `/chat`, bound to their own Workers AI, KV
  namespace, and Supabase project.

## Local setup

```bash
cd apps/web
cp .env.example .env
npm install
npx prisma migrate dev
npm run dev
```

```bash
cd worker-template
npm install
npm test          # vitest against mocked AI/KV bindings
npx wrangler dev   # local worker runtime
```

## What needs your own accounts to finish

This was built without live Supabase/Cloudflare dev credentials, so the OAuth round
trips and live provisioning are implemented against the documented APIs but not
exercised end-to-end here. Before shipping:

1. Register the platform as a Supabase OAuth app (org Settings → OAuth Apps) and a
   Cloudflare self-managed OAuth client (`Manage account > OAuth clients`) — fill in
   the resulting client id/secret in `apps/web/.env`.
2. Confirm the exact Cloudflare OAuth scope strings on the live "create OAuth client"
   screen (the public changelog didn't enumerate them exhaustively) — see
   `lib/cloudflare.ts`'s `CLOUDFLARE_OAUTH_SCOPES` constant.
3. Confirm the current Workers AI text-generation model id against
   `developers.cloudflare.com/workers-ai/models/` (the catalog had a deprecation wave
   in May 2026) — see `worker-template/src/tailor.ts`'s `TEXT_MODEL` constant.
