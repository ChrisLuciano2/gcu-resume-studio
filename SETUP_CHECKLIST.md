# Setup checklist — what you personally need to do outside this codebase

Everything below is a manual step in someone else's UI. Do them in this order —
later steps depend on values from earlier ones.

**Status as of 2026-09-16: steps 1–5 all done.** Remaining: the Cloudflare OAuth
client is still private (only usable by the account that registered it) — it
needs domain verification before a real student's Cloudflare account can
authorize against it. See `README.md`'s "Account setup status" for specifics
(which Supabase org, which scopes, which model ids got confirmed).

## 1. Generate `MASTER_KEY`

This is the AES-256-GCM key that encrypts every OAuth token and every student's
Supabase service-role key at rest. There's no dashboard for this one — generate it
locally.

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
   ever lose it, every encrypted token/key already in the database becomes
   permanently undecryptable — there's no recovery path, by design.

Also generate a second, separate random value for `SESSION_SECRET` the same way
(`openssl rand -base64 32` again) — it signs login cookies, don't reuse the
`MASTER_KEY` value for it.

## 2. Provision a real Postgres database and set `DATABASE_URL`

This is the **central platform's own** database (accounts + encrypted connection
tokens only — never resume content). Any managed Postgres works; here's the
straightforward path:

1. Go to [supabase.com](https://supabase.com) (yes, Supabase again, but this one is
   *your* project for the platform itself, separate from anything students
   connect) → sign in → **New project**.
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

## 3. Register the Supabase OAuth app

This lets the platform create/manage **student** Supabase projects on their
behalf via OAuth — separate from the platform's own database in step 2.

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and sign in
   with the account/organization that should own newly created student projects
   (create a dedicated org for this if you don't want student projects mixed in
   with your personal ones — recommended).
2. Click your organization name (top left) → **Organization settings**.
3. In the left sidebar, click **OAuth Apps**.
4. Click **Add application** (top right).
5. Fill in:
   - **Name**: something like `GCU Resume Studio`
   - **Website URL**: your app's URL (`http://localhost:3000` for local dev)
   - **Redirect URL**: exactly `http://localhost:3000/api/connections/supabase/callback`
     for local dev, or your real domain's equivalent in production — this must
     match `SUPABASE_OAUTH_REDIRECT_URI` in `.env` byte-for-byte.
6. Click **Confirm** / **Create**.
7. Copy the resulting **Client ID** and **Client Secret** (the secret is only
   shown once — copy it now) into `apps/web/.env`:
   ```
   SUPABASE_OAUTH_CLIENT_ID="..."
   SUPABASE_OAUTH_CLIENT_SECRET="..."
   ```
8. Find your organization's ID: still in **Organization settings** → **General**,
   copy the **Organization ID** shown there (looks like `org_xxxxxxxxxxxx`) into
   `SUPABASE_ORG_ID=` in `.env`. This is the org new student projects get created
   under when they connect.

## 4. Register the Cloudflare self-managed OAuth client

This is the newer (June 2026) mechanism this build uses as the *primary*
Cloudflare connection path (pasted API token is the fallback, already built).

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

## 5. Confirm the Workers AI model id

Separate from the OAuth setup, but also a "go check a live source" item:
`worker-template/src/index.js`'s `TEXT_MODEL` constant currently points at
`@cf/meta/llama-3.1-8b-instruct`. Before relying on it:

1. Go to [developers.cloudflare.com/workers-ai/models/](https://developers.cloudflare.com/workers-ai/models/).
2. Confirm that model id is still listed (not deprecated) — there was a
   deprecation wave in May 2026, so double check rather than assuming.
3. If it's gone, pick a similarly-sized current instruction-tuned model from that
   page and update `TEXT_MODEL` in `worker-template/src/index.js`.

## After all five: restart the app

Once `.env` has real values for `MASTER_KEY`, `SESSION_SECRET`, `DATABASE_URL`,
`SUPABASE_OAUTH_CLIENT_ID`/`SECRET`/`SUPABASE_ORG_ID`, and
`CLOUDFLARE_OAUTH_CLIENT_ID`/`SECRET`:

```
cd apps/web
npm run dev
```

The server now validates all of this at startup (see `instrumentation.ts`) — if
anything above is missing or malformed, it'll refuse to serve requests and log
exactly which value is the problem, rather than starting up and failing
mysteriously later.
