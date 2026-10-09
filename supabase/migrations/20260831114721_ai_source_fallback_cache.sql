-- Backend-only cache; no project, scan or learning-governance rows are changed.
-- Filename matches the version recorded by Supabase apply_migration.
create table public.ai_source_fallback_cache (
  id serial primary key,
  cache_key text not null constraint ai_source_fallback_cache_cache_key_unique unique,
  source_name text not null,
  source_url text not null,
  content_hash text not null,
  start_date date,
  end_date date,
  model text not null,
  prompt_hash text not null,
  cache_version integer not null,
  result_json jsonb not null,
  result_count integer not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '6 hours'),
  constraint ai_source_cache_array_check check (jsonb_typeof(result_json) = 'array'),
  constraint ai_source_cache_count_check check (result_count >= 0 and result_count = jsonb_array_length(result_json)),
  constraint ai_source_cache_window_check check (start_date is null or end_date is null or start_date <= end_date)
);
create index ai_source_fallback_cache_expiry_idx on public.ai_source_fallback_cache (expires_at);
alter table public.ai_source_fallback_cache enable row level security;
revoke all on public.ai_source_fallback_cache from public, anon, authenticated;
revoke all on sequence public.ai_source_fallback_cache_id_seq from public, anon, authenticated;
grant select, insert, update on public.ai_source_fallback_cache to service_role;
grant usage, select on sequence public.ai_source_fallback_cache_id_seq to service_role;
comment on table public.ai_source_fallback_cache is
  'Backend-only raw paid source extraction cache. Empty arrays are valid; all cache reads must pass current source/date/project eligibility gates. Six-hour non-sliding expiry.';
