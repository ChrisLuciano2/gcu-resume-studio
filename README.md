# GCU Resume Studio — backend

Bring-your-own-infra resume tailoring tool: each student connects one Cloudflare
account, which gets their own D1 database (data) and Worker (compute + Workers AI),
so no student's chatbot usage is capped by another student's traffic — and no one
has to run or pay for shared infrastructure after this project's original author
graduates. (Earlier versions of this project used a per-student Supabase project
instead of D1 — see PLAN.md's history note for why that was dropped: it doubled
onboarding to two OAuth connections for no benefit, since Postgres/pgvector's one
differentiator, ANN vector search, was never actually used.)

Note: the *central* platform database (`DATABASE_URL` below) happens to be hosted
on a Supabase-provided Postgres instance — that's just this deployment's choice of
Postgres host for its own small central DB, unrelated to and unaffected by the
per-student architecture described above.

See [`PLAN.md`](./PLAN.md) for the full architecture writeup (data model, OAuth flows,
provisioning sequence, Worker responsibilities).

## Layout

- `apps/web` — the central Next.js orchestrator: student auth, OAuth + provisioning
  against the Cloudflare API, the resume editor / bank / connect-account UI, the
  public `/r/[slug]` recruiter-facing resume page + chatbot router.
- `worker-template` — the Cloudflare Worker source deployed into each student's own
  account. Exposes `/embed`, `/tailor`, `/chat`, bound to their own Workers AI, KV
  namespace, and D1 database.

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
3. ✅ Cloudflare self-managed OAuth client registered. The scope names in
   `lib/cloudflare.ts`'s `CLOUDFLARE_OAUTH_SCOPES` are confirmed against the live
   wizard, not guessed from the changelog — see that file's comment for what's
   independently verified vs. inferred. This scope set does **not** cover D1 (see
   below) — the "paste a scoped API token" fallback on the connect screen is the
   confirmed-working path for D1 access until/unless a D1 OAuth scope is added.
4. ✅ Workers AI model ids confirmed live: `llama-3.1-8b-instruct` (the original
   placeholder) is gone from the catalog entirely; `worker-template/src/index.js`'s
   `TEXT_MODEL` now points at `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, confirmed
   live 2026-09-16. `EMBEDDING_MODEL` (`bge-base-en-v1.5`) confirmed unchanged.
5. ✅ D1 confirmed live end-to-end on 2026-09-16 via a scoped API token (create
   database, run schema, query, delete) — exact request/response shapes match
   what `lib/cloudflare.ts`'s `createD1Database`/`d1Query` expect.

Not yet done:
- The Cloudflare OAuth client is still **private** (usable only by the account
  that registered it) — domain verification to make it **public** is needed
  before real students (a different Cloudflare account) can authorize against it.
- The OAuth client's scopes don't include D1 access, and the exact OAuth scope
  slug D1 would need is unconfirmed (see `lib/cloudflare.ts`). Every student
  currently needs the paste-a-token path to get D1 access; if someone confirms
  the right scope slug later, OAuth could cover the whole flow.
