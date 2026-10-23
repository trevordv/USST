-- Additive archive fields used by the AU/NZ market-intelligence workflow.
-- Defaults preserve legacy Industry News rows.
alter table public.industry_news
  add column if not exists canonical_key text,
  add column if not exists region text,
  add column if not exists category text,
  add column if not exists source_class text,
  add column if not exists evidence_status text,
  add column if not exists development_status text,
  add column if not exists novelty_status text,
  add column if not exists lifecycle_stage text,
  add column if not exists importance integer,
  add column if not exists event_date date,
  add column if not exists secondary_topics jsonb not null default '[]'::jsonb,
  add column if not exists stakeholder_groups jsonb not null default '[]'::jsonb,
  add column if not exists capacity_facts jsonb not null default '[]'::jsonb,
  add column if not exists supporting_sources jsonb not null default '[]'::jsonb,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists industry_news_canonical_key_idx
  on public.industry_news (canonical_key);
create index if not exists industry_news_scan_id_idx
  on public.industry_news (scan_id);
create index if not exists industry_news_published_date_idx
  on public.industry_news (published_date);

create table if not exists public.industry_news_source_coverage (
  id serial primary key,
  scan_id integer not null references public.scans(id) on delete cascade,
  source_key text not null,
  source_name text not null,
  source_url text not null,
  geography text not null,
  source_class text not null,
  coverage text not null,
  access_method text not null default 'targeted-search',
  status text not null,
  candidate_count integer not null default 0,
  qualifying_count integer not null default 0,
  failure_reason text,
  latest_publication_at timestamptz,
  scanned_at timestamptz not null default now(),
  constraint industry_news_source_coverage_scan_source_unique
    unique (scan_id, source_key),
  constraint industry_news_source_coverage_counts_nonnegative
    check (candidate_count >= 0 and qualifying_count >= 0)
);

create index if not exists industry_news_source_coverage_scan_idx
  on public.industry_news_source_coverage (scan_id);
create index if not exists industry_news_source_coverage_source_scanned_idx
  on public.industry_news_source_coverage (source_key, scanned_at);

-- Coverage is backend-owned and must not be exposed through the Data API.
alter table public.industry_news_source_coverage enable row level security;
revoke all on public.industry_news_source_coverage from public, anon, authenticated;
revoke all on sequence public.industry_news_source_coverage_id_seq from public, anon, authenticated;
grant select, insert, update, delete on public.industry_news_source_coverage to service_role;
grant usage, select on sequence public.industry_news_source_coverage_id_seq to service_role;

comment on table public.industry_news_source_coverage is
  'Backend-owned per-scan audit of approved-source coverage for AU/NZ market intelligence.';
