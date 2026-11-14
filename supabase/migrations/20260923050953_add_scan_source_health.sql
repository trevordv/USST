-- Backend-owned per-source scan lineage. No provider payloads or credentials.
create table public.scan_source_health (
  id serial primary key,
  scan_id integer not null references public.scans(id) on delete cascade,
  source_name text not null,
  acquisition_method text not null,
  direct_attempted boolean not null default false,
  firecrawl_attempted boolean not null default false,
  firecrawl_succeeded boolean not null default false,
  apify_attempted boolean not null default false,
  bright_data_attempted boolean not null default false,
  openai_normalisation_attempted boolean not null default false,
  openai_normalisation_succeeded boolean not null default false,
  fallback_used boolean not null default false,
  outcome text not null,
  candidate_count integer not null default 0,
  qualifying_project_count integer not null default 0,
  duration_ms integer not null default 0,
  failure_category text,
  failure_reason text,
  content_fingerprint text,
  firecrawl_calls integer not null default 0,
  firecrawl_pages integer not null default 0,
  firecrawl_cache_reused boolean not null default false,
  created_at timestamptz not null default now(),
  constraint scan_source_health_scan_source_unique unique (scan_id, source_name),
  constraint scan_source_health_outcome_check check (outcome in (
    'success-with-results', 'success-zero-results', 'blocked', 'timeout',
    'extraction-failed', 'missing-credentials', 'rate-limited', 'provider-error'
  )),
  constraint scan_source_health_nonnegative_check check (
    candidate_count >= 0 and qualifying_project_count >= 0 and duration_ms >= 0 and
    firecrawl_calls >= 0 and firecrawl_pages >= 0
  ),
  constraint scan_source_health_fingerprint_check check (
    content_fingerprint is null or content_fingerprint ~ '^[a-f0-9]{64}$'
  )
);

create index scan_source_health_scan_id_idx on public.scan_source_health (scan_id);
create index scan_source_health_source_created_idx on public.scan_source_health (source_name, created_at desc);
create index scan_source_health_outcome_created_idx on public.scan_source_health (outcome, created_at desc);

alter table public.scan_source_health enable row level security;
revoke all on public.scan_source_health from public, anon, authenticated;
revoke all on sequence public.scan_source_health_id_seq from public, anon, authenticated;
grant select, insert, update on public.scan_source_health to service_role;
grant usage, select on sequence public.scan_source_health_id_seq to service_role;

comment on table public.scan_source_health is
  'Backend-owned safe per-source scan acquisition lineage. Contains no provider response bodies, credentials, cookies or auth headers.';
