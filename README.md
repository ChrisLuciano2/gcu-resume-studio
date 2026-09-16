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

## Account setup status

See [`SETUP_CHECKLIST.md`](./SETUP_CHECKLIST.md) for the full walkthrough. As of
2026-09-16, completed:

1. ✅ `MASTER_KEY` / `SESSION_SECRET` generated.
2. ✅ Central Postgres provisioned (Supabase project, Session pooler connection —
   the project's direct connection defaults to IPv6, so the pooler is what's in
   `DATABASE_URL`) and `prisma migrate dev` applied.
3. ✅ Supabase OAuth app registered (org: AI_Ready_Resume), scopes: Database
   (Read+Write), Projects (Read+Write), Secrets (Read-only).
4. ✅ Cloudflare self-managed OAuth client registered. The scope names in
   `lib/cloudflare.ts`'s `CLOUDFLARE_OAUTH_SCOPES` are now confirmed against the
   live wizard, not guessed from the changelog — see that file's comment for what's
   independently verified vs. inferred.
5. ✅ Workers AI model ids confirmed live: `llama-3.1-8b-instruct` (the original
   placeholder) is gone from the catalog entirely; `worker-template/src/index.js`'s
   `TEXT_MODEL` now points at `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, confirmed
   live 2026-09-16. `EMBEDDING_MODEL` (`bge-base-en-v1.5`) confirmed unchanged.

Not yet done: the Cloudflare OAuth client is still **private** (usable only by the
account that registered it) — domain verification to make it **public** is needed
before real students (a different Cloudflare account) can authorize against it.
