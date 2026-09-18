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
2026-09-17, completed:

1. ✅ `MASTER_KEY` / `SESSION_SECRET` generated.
2. ✅ Central Postgres provisioned (Supabase project, Session pooler connection —
   the project's direct connection defaults to IPv6, so the pooler is what's in
   `DATABASE_URL`) and `prisma migrate dev` applied.
3. ✅ Cloudflare self-managed OAuth client registered, now with 5 scopes including
   D1 (see next item) — the scope names in `lib/cloudflare.ts`'s
   `CLOUDFLARE_OAUTH_SCOPES` are confirmed against Cloudflare's own live
   `GET /api/v4/oauth/scopes` response, not guessed from the changelog — see that
   file's comment for what's independently verified vs. inferred.
4. ✅ Workers AI model ids confirmed live: `llama-3.1-8b-instruct` (the original
   placeholder) is gone from the catalog entirely; `worker-template/src/index.js`'s
   `TEXT_MODEL` now points at `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, confirmed
   live 2026-09-16. `EMBEDDING_MODEL` (`bge-base-en-v1.5`) confirmed unchanged.
5. ✅ D1 confirmed live end-to-end on 2026-09-16 via a scoped API token (create
   database, run schema, query, delete) — exact request/response shapes match
   what `lib/cloudflare.ts`'s `createD1Database`/`d1Query` expect.
6. ✅ D1 **OAuth** access resolved 2026-09-17 — the previous four scopes 401'd on
   every D1 endpoint because the slug D1 needs was never documented anywhere
   findable; confirmed it directly from Cloudflare's own `oauth/scopes` API
   (`d1.write`), added it to the live OAuth client (now 5 scopes), and verified an
   actual end-to-end OAuth connect run (authorize → token exchange → D1 database
   created) against a disposable test account. OAuth is no longer blocked on D1 —
   only the domain-verification item below still gates it for real students.

6. ✅ Deployed to production 2026-09-17/18 — Vercel Hobby tier,
   https://gcu-resume-studio.vercel.app. Found and fixed three real
   deploy-only bugs along the way (Next's file tracer couldn't see
   `worker-template/src/index.js`, Prisma Client wasn't regenerating on
   Vercel's cached installs, and — the serious one — provisioning was
   fire-and-forget and got silently killed by the serverless runtime before
   doing anything). Verified end-to-end against the live production URL:
   signup, OAuth connect, and D1/KV/Worker provisioning all confirmed
   actually completing, not just deploying without erroring.

Not yet done:
- The Cloudflare OAuth client is still **private** (usable only by the account
  that registered it) — domain verification to make it **public** is needed
  before real students (a different Cloudflare account) can authorize against
  it. The free `vercel.app` domain the production deploy uses can't be
  verified (you don't own it) — this needs a real owned domain, not just the
  hosted deployment. Token-paste works for every student regardless, so this
  isn't a hard blocker, just the gap between "works" and "OAuth works for
  everyone."

## Deploying to production

For real GCU students to use this (not just local dev), the app needs to be
hosted somewhere with a real URL. **Recommendation: Vercel**, free tier —
it's a stock Next.js app (App Router, no exotic runtime needs), so it's a
native fit with zero build-config beyond what's already in this repo. The main
downside is that it's a separate vendor account from the Cloudflare-per-student
model the rest of this project deliberately uses to avoid needing an owner
after graduation — someone still has to own the Vercel account (and, later,
the domain) once the original author is gone. Cloudflare Pages would keep
everything under one vendor, but Next.js there needs the `next-on-pages`
adapter and has rougher edges for API-route-heavy apps like this one — not
worth it unless single-vendor consolidation matters more than deploy
friction.

**A real, previously-undocumented deploy blocker was found and fixed on
2026-09-17**: `lib/provisioning/orchestrator.ts` reads
`worker-template/src/index.js` off disk at module load — that file lives
outside `apps/web` entirely, and this repo has no root `package.json`/workspace
config telling Next's build-time file tracer it exists. Without a fix, a
serverless deploy would have silently excluded it from the function bundle,
and every provisioning-dependent route (`/api/connections/cloudflare/callback`,
`/api/connections/cloudflare/token`, `/api/provisioning/status`) would have
thrown at cold start in production despite working fine in local dev, where
the whole repo just sits on disk together. Fixed via `outputFileTracingIncludes`
in `apps/web/next.config.mjs`; verified by running `npm run build` and
confirming `worker-template/src/index.js` shows up in each affected route's
`.next/server/app/**/*.nft.json` trace manifest.

What's left, and why it's left for you rather than done here: creating
accounts and registering a public domain aren't things this session can do on
your behalf.

1. **Pick a domain.** Doesn't need to be fancy — a subdomain of something you
   already own works fine (`resume.yourdomain.com`), or a fresh cheap domain.
2. **Create a Vercel account** (or use an existing one) and import this GitHub
   repo, with **Root Directory** set to `apps/web`.
3. **Set the production env vars** in Vercel's project settings — same names as
   `apps/web/.env`, but with production values:
   - `DATABASE_URL`, `MASTER_KEY`, `SESSION_SECRET` — reuse the same values as
     local dev, or generate fresh ones for prod (fresh `MASTER_KEY` means old
     encrypted tokens in that Postgres instance become undecryptable, so only
     do that against a *fresh* prod database, not the one carrying the two
     existing test accounts).
   - `CLOUDFLARE_OAUTH_CLIENT_ID` / `CLOUDFLARE_OAUTH_CLIENT_SECRET` — same
     values as local dev; it's the same OAuth client, just with an additional
     redirect URI (next step).
   - `CLOUDFLARE_OAUTH_REDIRECT_URI` — `https://<your-domain>/api/connections/cloudflare/callback`.
   - `APP_BASE_URL` — `https://<your-domain>`.
4. **Add the production redirect URI to the live Cloudflare OAuth client itself**
   (Manage account → OAuth clients → GCU Resume Studio → Edit → Redirect
   (Callback) URLs) — it's a multi-value field, so the existing
   `http://localhost:3000/...` entry can stay for continued local dev; add the
   `https://<your-domain>/...` one alongside it, don't replace it.
5. **Verify the domain** on the OAuth client (same Edit screen has a
   verification flow — a DNS TXT record) to flip it from private to public, so
   a real student's own Cloudflare account (not just yours) can authorize
   against it. This is the step that actually unblocks real students, not just
   deployment.
6. **Run the Prisma migration against the production database**:
   `DATABASE_URL="<prod-url>" npx prisma migrate deploy` (from `apps/web`) —
   `migrate deploy`, not `migrate dev`, for a non-interactive production apply.
