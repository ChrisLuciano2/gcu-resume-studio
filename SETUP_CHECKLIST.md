# Setup checklist — what you personally need to do outside this codebase

Everything below is a manual step in someone else's UI. Do them in this order —
later steps depend on values from earlier ones.

**Status as of 2026-09-16: steps 1–4 all done, D1 confirmed live via the
paste-a-token path (step 4).** Remaining: the Cloudflare OAuth client is still
private (only usable by the account that registered it) — it needs domain
verification before a real student's Cloudflare account can authorize against
it, and its scopes don't cover D1 (see step 4). See `README.md`'s "Account
setup status" for specifics (which scopes, which model ids got confirmed).

## 1. Generate `MASTER_KEY`

This is the AES-256-GCM key that encrypts every student's OAuth token / API
token at rest. There's no dashboard for this one — generate it locally.

1. Open a terminal on your machine (PowerShell or Git Bash both work).
2. Run:
   ```
   openssl rand -base64 32
   ```
   (If `openssl` isn't found on Windows, Git Bash ships one — run it from a Git
   Bash prompt, not PowerShell.)
3. Copy the output (a ~44-character base64 string).
4. Paste it as `MASTER_KEY=` in `apps/web/.env`.
5. **Back this value up somewhere outside the repo** (a password manager). If you
   ever lose it, every encrypted token already in the database becomes
   permanently undecryptable — there's no recovery path, by design.

Also generate a second, separate random value for `SESSION_SECRET` the same way
(`openssl rand -base64 32` again) — it signs login cookies, don't reuse the
`MASTER_KEY` value for it.

## 2. Provision a real Postgres database and set `DATABASE_URL`

This is the **central platform's own** database (accounts + encrypted connection
tokens only — never resume content). Any managed Postgres works; here's the
straightforward path:

1. Go to [supabase.com](https://supabase.com) (this is *your* project for
   hosting the platform's own small central database — unrelated to student
   resume data, which now lives in each student's own Cloudflare D1, not
   Supabase; see `README.md`'s note on this) → sign in → **New project**.
2. Pick an organization, name it something like `resume-studio-platform`, set a
   database password (save it), pick a region close to you, click **Create new
   project**. Wait ~2 minutes for it to provision.
3. Once it's ready: **Project Settings** (gear icon, bottom of left sidebar) →
   **Database** → under **Connection string**, select the **URI** tab → copy the
   connection string (it looks like
   `postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxx.supabase.co:5432/postgres`).
4. Replace `[YOUR-PASSWORD]` with the database password from step 2.
5. Paste the full string as `DATABASE_URL=` in `apps/web/.env`.
6. From `apps/web/`, run:
   ```
   npx prisma migrate dev --name init
   ```
   This creates the `User`, `Connection`, `ProvisioningRun`, and
   `PublicDraftIndex` tables. You should see a success message listing the
   migration.

(Any other Postgres host — Neon, Render, Railway, a local instance — works
identically; just get its connection URI into `DATABASE_URL` and run the same
`prisma migrate dev` command.)

## 3. Register the Cloudflare self-managed OAuth client

This is the *primary* Cloudflare connection path (pasted API token, covered in
step 4, is the fallback — and currently the only path that reaches D1, see
below).

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign in with the
   account that should own the OAuth client registration (this can be your own
   personal/organizational Cloudflare account — it's just registering the app,
   not where student Workers get deployed).
2. Click **Manage Account** in the left sidebar (or go directly to
   `https://dash.cloudflare.com/?to=/:account/oauth-clients`).
3. Click **OAuth clients** (or a similarly named entry under Account settings —
   this is a brand-new dashboard section, so the exact nav label may differ
   slightly from what's described here; look for "OAuth" under Account-level
   settings if it's not where expected).
4. Click **Create OAuth client** / **Add application**.
5. Fill in:
   - **Name**: `GCU Resume Studio`
   - **Redirect URI**: exactly `http://localhost:3000/api/connections/cloudflare/callback`
     for local dev (must match `CLOUDFLARE_OAUTH_REDIRECT_URI` in `.env`).
   - **Scopes**: select the scopes this build requests — look for and check:
     - `user-details.read` (or whatever the account-identification scope is
       labeled)
     - `account:read`
     - `workers-scripts.write` (or the equivalent "Workers Scripts: Edit"
       permission)
     - `workers-kv-storage.write` (or "Workers KV Storage: Edit")

     **Important — confirm before checking boxes**: the exact scope names/labels
     shown in this dashboard screen are what's authoritative. `apps/web/lib/cloudflare.ts`
     has a `CLOUDFLARE_OAUTH_SCOPES` constant with best-effort names from the
     public changelog, not a verified exhaustive list. Whatever you see checked
     off in this UI, copy those exact string values back into that constant in
     the code before relying on it — don't assume the code already has the right
     ones.

     **D1 is not in this list on purpose.** Confirmed live 2026-09-16: this
     OAuth client's current scopes get a 401 on every D1 endpoint, and the
     exact scope slug D1 would need isn't documented anywhere findable. If you
     want to try adding it anyway, look for a "D1" entry in this same scope
     picker and check it — then re-test via a fresh reconnect. If it doesn't
     work or you'd rather not chase it, that's fine: the app already falls back
     to the paste-a-token path (step 4) for D1, and every student can use that
     regardless of what this OAuth client can do.
6. Save/create the client. It starts **private** (usable only by your own account)
   — that's fine for development; you'd need to verify a domain to make it
   **public** for other Cloudflare accounts (i.e., actual students) to authorize
   against it. Do that domain verification step before this goes live for real
   students.
7. Copy the **Client ID** and **Client Secret** into `apps/web/.env`:
   ```
   CLOUDFLARE_OAUTH_CLIENT_ID="..."
   CLOUDFLARE_OAUTH_CLIENT_SECRET="..."
   ```

## 4. The paste-a-token fallback (needed for D1 until/unless step 3's OAuth client covers it)

Every student can use this path instead of OAuth, and it's the only
confirmed-working path to D1 access right now. It's the same "Connect
Cloudflare" screen — there's a "paste a scoped API token" option below the
OAuth button.

To create a token (yourself, for testing, or hand these steps to a student):

1. Go to **dash.cloudflare.com** and sign in.
2. Click your profile icon (top right) → **My Profile**.
3. Left sidebar → **API Tokens** → **Create Token**.
4. Scroll to the bottom → **Create Custom Token** (skip the templates).
5. Name it (e.g. `resume-studio`).
6. Under **Permissions**, add three rows:
   - `Account` → `Workers Scripts` → `Edit`
   - `Account` → `Workers KV Storage` → `Edit`
   - `Account` → `D1` → `Edit`
7. Under **Account Resources**, select the specific account this token should
   apply to (not "All accounts").
8. Leave **Zone Resources** alone — not needed.
9. **Continue to summary** → confirm the three permissions are listed →
   **Create Token**.
10. Copy the token (shown once) and paste it into the connect screen's
    "paste a scoped API token" field.

## 5. Confirm the Workers AI model id

Separate from the OAuth setup, but also a "go check a live source" item:
`worker-template/src/index.js`'s `TEXT_MODEL` constant currently points at
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Before relying on it:

1. Go to [developers.cloudflare.com/workers-ai/models/](https://developers.cloudflare.com/workers-ai/models/).
2. Confirm that model id is still listed (not deprecated) — the catalog churns,
   so double check rather than assuming.
3. If it's gone, pick a similarly-sized current instruction-tuned model from that
   page and update `TEXT_MODEL` in `worker-template/src/index.js`.

## After steps 1–3: restart the app

Once `.env` has real values for `MASTER_KEY`, `SESSION_SECRET`, `DATABASE_URL`,
and `CLOUDFLARE_OAUTH_CLIENT_ID`/`SECRET`:

```
cd apps/web
npm run dev
```

The server now validates all of this at startup (see `instrumentation.ts`) — if
anything above is missing or malformed, it'll refuse to serve requests and log
exactly which value is the problem, rather than starting up and failing
mysteriously later.
