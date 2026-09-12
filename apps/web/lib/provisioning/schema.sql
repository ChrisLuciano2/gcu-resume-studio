-- Per-student Supabase schema. Run once via the Management API's
-- POST /v1/projects/{ref}/database/query, after the project reports ACTIVE_HEALTHY.
-- Generic across every field/major — no field-specific tables or columns.

create extension if not exists vector;

create table if not exists resumes (
  id uuid primary key default gen_random_uuid(),
  raw_text text not null,
  uploaded_at timestamptz not null default now()
);

create table if not exists resume_chunks (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid references resumes(id) on delete cascade,
  section text not null,        -- Experience / Projects / Skills / Education / ...
  position int not null,
  heading text,
  meta text,                    -- e.g. "Company · Dates"
  bullets jsonb not null default '[]',
  tags jsonb not null default '[]',   -- e.g. skills chips
  embedding vector(768)         -- @cf/baai/bge-base-en-v1.5
);

create index if not exists resume_chunks_embedding_idx
  on resume_chunks using ivfflat (embedding vector_cosine_ops);

create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,                -- broad field, e.g. "Nursing"
  niche text,                   -- e.g. "Pediatric"
  is_default boolean not null default false,
  slug text unique not null,
  plan jsonb not null,          -- resolved section/chunk order + text AS APPROVED
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chat_cache (
  draft_id uuid references drafts(id) on delete cascade,
  question_hash text not null,
  answer text not null,
  created_at timestamptz not null default now(),
  primary key (draft_id, question_hash)
);

-- Display-only mirror for the Settings screen — never holds secrets. The real
-- OAuth tokens / service-role key live in the central platform DB (see
-- apps/web/prisma/schema.prisma's Connection model).
create table if not exists connections (
  provider text primary key,    -- 'supabase' | 'cloudflare'
  status text not null,
  connected_at timestamptz
);
