-- Per-student Cloudflare D1 (SQLite) schema. Run once via the D1 query API,
-- one statement per call — see lib/cloudflare.ts's d1Query and
-- lib/provisioning/orchestrator.ts. Generic across every field/major — no
-- field-specific tables or columns.
--
-- No vector column type and no ANN index here (unlike the earlier
-- Postgres/pgvector version this replaced): retrieval only ever ranks a
-- handful of chunks for one resume, so the Worker computes cosine similarity
-- in plain JS over `embedding` (stored as a JSON-encoded float array in TEXT)
-- rather than needing a real vector index. IDs are generated in app code
-- (crypto.randomUUID()) since SQLite has no default-uuid function; timestamps
-- are ISO-8601 TEXT supplied by app code, not a DB default, for the same
-- reason. Every CREATE TABLE keeps IF NOT EXISTS so a retried provisioning
-- run after a partial failure never errors out re-creating a table that's
-- already there.

create table if not exists resumes (
  id text primary key,
  raw_text text not null,
  uploaded_at text not null
);

create table if not exists resume_chunks (
  id text primary key,
  resume_id text references resumes(id) on delete cascade,
  section text not null,        -- Experience / Projects / Skills / Education / ...
  position integer not null,
  heading text,
  meta text,                    -- e.g. "Company · Dates"
  bullets text not null default '[]',  -- JSON-encoded array
  tags text not null default '[]',     -- JSON-encoded array, e.g. skills chips
  embedding text                       -- JSON-encoded float array, @cf/baai/bge-base-en-v1.5
);

create table if not exists drafts (
  id text primary key,
  name text not null,
  category text,                -- broad field, e.g. "Nursing"
  niche text,                   -- e.g. "Pediatric"
  is_default integer not null default 0,
  slug text unique not null,
  plan text not null,           -- JSON-encoded resolved section/chunk order + text AS APPROVED
  source_updated_at text,
  created_at text not null,
  updated_at text not null,
  -- Added 2026-09-16 for job-description-based tailoring. This CREATE TABLE
  -- only reaches new databases — an already-provisioned student's existing
  -- `drafts` table gets it via orchestrator.ts's ensureColumn call instead,
  -- since CREATE TABLE IF NOT EXISTS is a no-op on a table that already
  -- exists (it does not add missing columns to it).
  job_description text,
  -- Added 2026-09-16 for cover-letter generation — same ensureColumn
  -- backfill note above applies here too.
  cover_letter text
);

create table if not exists chat_cache (
  draft_id text references drafts(id) on delete cascade,
  question_hash text not null,
  answer text not null,
  created_at text not null,
  primary key (draft_id, question_hash)
);
