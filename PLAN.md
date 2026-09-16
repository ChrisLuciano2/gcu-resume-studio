# GCU Resume Studio — backend implementation plan

## Update (2026-09-16): Supabase replaced with Cloudflare D1

Everything below describes the **original** architecture, kept as-is for the
history/reasoning trail rather than rewritten to pretend it was always this
way. As of 2026-09-16, the per-student data store changed from a
Supabase/Postgres/pgvector project to a Cloudflare D1 (SQLite) database, and
every `Connection(provider: SUPABASE)` row / Supabase OAuth flow described
below no longer exists in the code. The reasoning, in short (see the approved
migration plan at `C:\Users\17143\.claude\plans\reflective-jumping-mochi.md`
for the full writeup):

- The one thing Postgres/pgvector actually offered over SQLite — ANN vector
  search — was never used. Retrieval only ever ranks a handful of chunks for
  one resume, so `worker-template/src/index.js` always computed cosine
  similarity in plain JS over chunks fetched by known id, not via a real
  vector index. Dropping Postgres cost nothing functionally.
- Two developer-platform OAuth connections (Supabase *and* Cloudflare) before
  a student could do anything was the single biggest onboarding-friction risk
  identified in a later product review of this codebase. One connection
  (Cloudflare only, now provisioning a D1 database instead of a Supabase
  project) is a meaningfully smaller ask.
- Driven by a real constraint: this project's original author graduates in
  December 2026 and wants it to run afterward with no ongoing maintainer, no
  shared bill, and no one inheriting an AI-quota/abuse problem. Per-student
  BYO-infra stays (each student still owns their own data and compute, on
  their own free account) — it's just down to one provider instead of two.

Everything student-data-related now lives in D1: `apps/web/lib/provisioning/schema.sql`
(SQLite dialect — see that file's header for the specific type/dialect changes),
`apps/web/lib/studentD1.ts` (replaces `lib/studentSupabase.ts`),
`apps/web/lib/cloudflare.ts`'s `createD1Database`/`d1Query` (replaces
`lib/supabaseManagement.ts`, deleted), and `worker-template/src/index.js`'s D1
binding (`env.DB`, replaces its Supabase REST calls). The central Postgres DB
(`Connection`, `User`, `ProvisioningRun`, `PublicDraftIndex`) is unaffected —
that was never the thing being replaced. A public resume website
(`app/r/[slug]/page.tsx`) with a native-browser print/PDF version was added at
the same time, on top of the new D1 data layer.

## Context (original, 2026-09 — describes the Supabase-based architecture this project started with)

The design brief (`student-tool-design-brief.md`) and the imported Claude Design file (`Connect Accounts.dc.html`, GCU purple `#522398` / IBM Plex dev-tool system) spec a resume-tailoring tool where **each student runs their own infrastructure** — their own Supabase project (data) and Cloudflare account (compute + Workers AI) — so no student's chatbot usage is capped by another student's traffic. This plan builds the backend that makes that real: account provisioning, ingestion, tailoring, and the public per-draft chatbot.

This is greenfield — no existing project for it (checked `Desktop`, `Dev Projects`, `resume/`, `microdegree-main`: unrelated). Confirmed with the user: build a central **Next.js** orchestrator app; use a small central Postgres DB (its own, platform-owned) purely to bootstrap accounts and hold encrypted OAuth tokens before a student's own Supabase project exists; use **Cloudflare's self-managed OAuth clients** (shipped June 2026 — `workers-scripts.write`, `workers-kv-storage.write`, `user-details.read` scopes confirmed via changelog) as the primary Cloudflare connection method, with the pasted-API-token flow (already fully designed in the UI) as fallback.

**Why a deployed Worker, not just server-side REST calls to Workers AI:** the brief wants a real "Worker deployed / KV bound" step (matches the checklist UI), and routing all AI + rate-limit state through the student's own deployed Worker means Workers AI usage genuinely runs on their account via their own binding — not just an API call our server happens to attribute to them. It also gives the public `/r/[slug]` chatbot a natural rate-limit/cache store (KV) scoped per student.

## Architecture

```
apps/web (Next.js, TS, App Router)
├─ central Postgres (Prisma) — platform accounts + encrypted connection tokens only
├─ orchestrates OAuth + provisioning against Supabase Management API & Cloudflare API
├─ owns the resume editor / bank / connect-accounts UI (built from Connect Accounts.dc.html)
└─ proxies AI calls to each student's own deployed Cloudflare Worker

worker-template (Cloudflare Worker source, deployed per student by the orchestrator)
├─ bindings: AI (Workers AI), KV (per-student namespace), env: SUPABASE_URL + SUPABASE_SERVICE_KEY
├─ POST /embed   — embeds resume chunk text (used during ingestion)
├─ POST /tailor  — full rewrite for a target field, reads/writes via Supabase directly
└─ POST /chat    — public RAG chatbot for a draft slug, rate-limited + cached via KV

each student's own Supabase project (provisioned by the orchestrator)
└─ tables: resumes, resume_chunks (pgvector), drafts, chat_cache, connections (display-only)
```

The **central DB** never stores resume content — only what's needed to log a student in, drive provisioning, and reconnect: `User`, `Connection` (per provider: encrypted OAuth tokens, provider account id, status, metadata like project ref / worker URL / KV namespace id), `ProvisioningRun` (step log, polled by the Connect Accounts UI).

The **student's Supabase project** holds all resume/draft content and a `connections` table that mirrors *status only* (for the Settings screen) — never secrets.

## Central DB schema (Prisma) — `apps/web/prisma/schema.prisma`

- `User(id, email, passwordHash|authProvider, createdAt)`
- `Connection(id, userId, provider: SUPABASE|CLOUDFLARE, method: OAUTH|TOKEN, status: NOT_CONNECTED|CONNECTING|CONNECTED|ERROR, encryptedAccessToken, encryptedRefreshToken, encryptedApiToken, providerAccountId, metadataJson, lastError, updatedAt)` — `metadataJson` holds `{ projectRef, projectUrl, anonKey, serviceRoleKeyEncrypted, workerUrl, kvNamespaceId, accountId }`
- `ProvisioningRun(id, userId, stepsJson: [{key,label,state,completedAt}], updatedAt)`
- `PublicDraftIndex(slug unique, userId, workerUrl, updatedAt)` — the routing table `/r/[slug]` actually depends on. A recruiter link only carries a slug; nothing else in the central DB maps a bare slug back to a student. This row is written/updated whenever a draft is created, renamed... no — slugs don't change on rename (draft `name` and `slug` are independent per the per-student schema), so it's written once at draft-creation time (from `drafts/[id]/...` handlers, after inserting the row in the student's own Supabase) and deleted when a draft is deleted. `workerUrl` is cached here purely so `/r/[slug]` resolves in one central-DB lookup instead of a round trip to fetch the student's `Connection` row first; treat it as a cache of `Connection.metadataJson.workerUrl` and refresh it if a redeploy ever changes the Worker's URL.

Tokens encrypted with AES-256-GCM using a server-only `MASTER_KEY` env var (`lib/crypto.ts`). Never sent to the browser.

## Per-student Supabase schema — `apps/web/lib/provisioning/schema.sql`

```sql
create extension if not exists vector;

create table resumes (
  id uuid primary key default gen_random_uuid(),
  raw_text text not null,
  uploaded_at timestamptz not null default now()
);

create table resume_chunks (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid references resumes(id) on delete cascade,
  section text not null,        -- Experience / Projects / Skills / Education / ...
  position int not null,
  heading text,
  meta text,                    -- e.g. "Company · Dates"
  bullets jsonb default '[]',
  tags jsonb default '[]',      -- e.g. skills chips
  embedding vector(768)         -- @cf/baai/bge-base-en-v1.5
);
create index on resume_chunks using ivfflat (embedding vector_cosine_ops);

create table drafts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,                -- broad field, e.g. "Nursing"
  niche text,                   -- e.g. "Pediatric"
  is_default boolean not null default false,
  slug text unique not null,
  plan jsonb not null,          -- resolved section/chunk order + text AS APPROVED — never re-derived
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table chat_cache (
  draft_id uuid references drafts(id) on delete cascade,
  question_hash text not null,
  answer text not null,
  created_at timestamptz not null default now(),
  primary key (draft_id, question_hash)
);

create table connections (
  provider text primary key,    -- 'supabase' | 'cloudflare'
  status text not null,
  connected_at timestamptz
);
```

Run via Management API `POST /v1/projects/{ref}/database/query` once the project's status polls to `ACTIVE_HEALTHY`.

## OAuth + provisioning flows — `apps/web/app/api/connections/**`

**Supabase** (`.../supabase/start`, `.../supabase/callback`):
1. Redirect to `https://api.supabase.com/v1/oauth/authorize` (PKCE, `state` = signed nonce tied to session).
2. Exchange code at `POST https://api.supabase.com/v1/oauth/token` (client_id/secret via HTTP Basic).
3. `POST /v1/projects` (Management API) to create the project; poll `GET /v1/projects/{ref}` until `ACTIVE_HEALTHY`.
4. Run `schema.sql` via `POST /v1/projects/{ref}/database/query`.
5. Store `projectRef`, `projectUrl`, `anonKey`, encrypted `serviceRoleKey` (returned at creation) in `Connection.metadataJson`.

**Cloudflare** (`.../cloudflare/start`, `.../cloudflare/callback`, `.../cloudflare/token` for the fallback):
1. OAuth: register the platform as a self-managed OAuth client in the Cloudflare dashboard once (`Manage account > OAuth clients`); request scopes `user-details.read workers-scripts.write workers-kv-storage.write account:read` — **verify exact scope strings against the live "create OAuth client" screen at implementation time**, the changelog names weren't exhaustively documented.
2. Create a KV namespace: `POST /accounts/{account_id}/storage/kv/namespaces`.
3. Deploy the Worker template: `PUT /accounts/{account_id}/workers/scripts/{name}` (multipart module upload) with bindings for `AI`, the new KV namespace, a **plain_text** binding for `SUPABASE_URL` (not sensitive — it's a public project URL), and a **secret_text** binding for `SUPABASE_SERVICE_KEY`. The service role key bypasses row-level security entirely, so it must never be a `plain_text` binding (visible in the dashboard/API metadata) — it goes in via the same multipart metadata but with `type: "secret_text"`, which Cloudflare stores encrypted and never returns in subsequent reads. Provisioning order matters here regardless: Supabase must finish first (so the service key exists to bind), or the Worker deploy step waits, matching the UI's step list.
4. Enable a `workers.dev` route (or read the default one back) to get the public Worker URL; store it in `Connection.metadataJson`.
5. Token fallback: `.../cloudflare/token` accepts a pasted scoped token (validate with `GET /user/tokens/verify`) and proceeds from step 2.

**Provisioning progress** is one `ProvisioningRun` row per user with a `stepsJson` array (`schema created`, `worker deployed`, `kv bound`, etc. — matches the `steps`/`provRows` props in `Connect Accounts.dc.html`); `GET /api/provisioning/status` is polled by the UI (the design doc polls rather than expecting a push).

## Worker template — `worker-template/src/index.ts`

- `POST /embed { texts: string[] }` → `env.AI.run('@cf/baai/bge-base-en-v1.5', { text })`, returns vectors. Used by ingestion.
- `POST /tailor { chunks, targetField }` → one AI call (confirm current text-gen model id against `developers.cloudflare.com/workers-ai/models/` at build time — the catalog churns; a Llama-3.1-8B-instruct-class instruction model is the right size/quality trade-off) with a strict system prompt: reorder/re-emphasize only, never invent facts, output the same chunk IDs with new order/emphasis. **Timeout**: `AbortSignal.timeout(20_000)` around the AI call; on timeout/error return `{ ok:false, reason:'timeout' }` so the editor's generating state resolves instead of hanging.
- `POST /chat { slug, question }` → looks up the draft's chunks (direct Supabase query using the bound service key), vector-searches top-k via pgvector, checks `chat_cache` first, else calls the AI model grounded only in retrieved chunks for that slug, writes the cache row. **Rate limit**: KV counter key `rl:{slug}:{yyyy-mm-dd}` capped at an env-configured `DAILY_CHAT_BUDGET` (default 20, inside the 15–25 free-tier band) — return 429 with a friendly "come back tomorrow" message once exhausted.

## App routes — `apps/web/app/api/**`

- `resumes/ingest` (POST, multipart upload) — extract text (`pdf-parse` for PDF, `mammoth` for `.docx`, raw for `.txt`), generic section-boundary chunking (heading-pattern detection for common section names, paragraph-level fallback — no field-specific logic), call the student's Worker `/embed`, insert `resumes` + `resume_chunks` rows via the student's Supabase (service key), auto-create the default `drafts` row (`is_default = true`, `plan` = untailored chunk order) **and upsert its `PublicDraftIndex` row in the same request** — this is the draft every student gets with zero effort, so it's the one draft-creation path most likely to be reached before any tailoring handler ever runs, and skipping the index write here would mean the default resume's share link 404s while every later tailored draft works fine.

  **Every place a `drafts` row is created or removed must keep `PublicDraftIndex` in sync in the same transaction/request** — there are exactly three: `resumes/ingest` (default draft, above), `drafts/[id]/tailor` → `saveNew` (new tailored draft), and `drafts/[id]/duplicate` (new slug from an existing draft). `drafts/[id]/delete` is the one removal path. No other route inserts or deletes a `drafts` row, so this list is exhaustive — a new draft-creation path added later must extend it too.
- `drafts` (CRUD) + `drafts/[id]/tailor` (POST) — proxies to the student's Worker `/tailor`, returns the proposed plan for the review step (save-as-new vs apply-in-place — never auto-persists). On `saveNew`/`applyHere` committing a **new** draft (new slug), also upsert a `PublicDraftIndex` row (`slug`, `userId`, cached `workerUrl`) in the central DB — this is the only place that index gets written.
- `drafts/[id]/rename|duplicate|delete` — `duplicate` mints a new slug and inserts a matching `PublicDraftIndex` row; `delete` removes the `PublicDraftIndex` row alongside the student-side `drafts` row so a dead slug 404s instead of leaking a stale route.
- `r/[slug]` (public page) + `r/[slug]/chat` (POST, public, proxies to the student's Worker `/chat`) — looks up `PublicDraftIndex` by slug first (the only central-DB table that maps a bare public slug to a student at all — nothing else in the central schema can answer "whose link is this"), then either calls the cached `workerUrl` directly or falls back to the owning `Connection.metadataJson.workerUrl` if the cache looks stale, before proxying to `/chat`. Serves only that one draft's locked `plan` — never another draft's or student's data.

## Frontend

Recreate the three screens from `Connect Accounts.dc.html` as real React components under `apps/web/app`, matching the design tokens 1:1 from `design-system.md` (colors, IBM Plex Sans/Mono, 6px/4px radii, the specific motion timings) rather than copying the `.dc.html`'s templating markup. Wire the exact prop shapes already modeled in the prototype (`steps[]`, `liveCards[]`, `provRows[]`, `categories[]/items[]`, `navItems[]`, `drafts[]`, `resumeSections[].chunks[]`) directly to the API responses above so no UI redesign is needed.

## Flags for the user (per the request to confirm against live docs, not guess)

1. **Cloudflare OAuth scope names** — changelog didn't enumerate the full list; confirm exact strings when creating the OAuth client in the dashboard.
2. **Workers AI text-generation model id** — the catalog had 18 models deprecated in May 2026; pick the live model id from `/workers-ai/models/` at build time rather than hardcoding one now.
3. **Supabase Management API rate/quota limits** on project creation per org weren't documented in what I could fetch — worth a quick check in the Supabase dashboard/support docs before assuming unlimited student signups.
4. Cloudflare self-managed OAuth is very new (June 2026); if it proves flaky for some student accounts, the pasted-token fallback (already fully designed in the UI, already planned in `token` endpoint above) covers it.

## Verification

No live Supabase/Cloudflare dev accounts are available in this environment, so end-to-end OAuth + provisioning can't be exercised here. I will:
- `tsc --noEmit` + `next build` to confirm the app compiles.
- Unit tests (`vitest`) for: the AES encryption round-trip, the generic resume-chunking heuristic against a couple of sample resumes (with and without clear headings), and the Worker's rate-limit/cache logic (mocked KV).
- `wrangler dev` locally against the Worker template with mocked AI/KV bindings to confirm `/embed`, `/tailor`, `/chat` respond in the expected shape and the timeout/fallback path actually resolves.
- Manually walk the Connect Accounts UI against the mocked provisioning endpoints (`ProvisioningRun` step transitions) in a local Next.js dev server, since a real OAuth round-trip needs your actual Supabase/Cloudflare accounts to test.
