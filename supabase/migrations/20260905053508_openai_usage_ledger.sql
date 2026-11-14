-- Backend-only observability. Logging failures are isolated in application code.
create table public.openai_usage_ledger (
  id serial primary key,
  created_at timestamptz not null default now(),
  operation text not null,
  source_name text,
  source_url text,
  source_identifier text,
  project_id integer,
  model text not null,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  web_search_calls integer,
  response_id text,
  result_count integer,
  cache_hit boolean not null default false,
  success boolean not null,
  estimated_cost_usd numeric(18,10),
  latency_ms integer not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint openai_usage_ledger_nonnegative_check check (
    coalesce(input_tokens,0) >= 0 and coalesce(cached_input_tokens,0) >= 0 and
    coalesce(output_tokens,0) >= 0 and coalesce(reasoning_tokens,0) >= 0 and
    coalesce(web_search_calls,0) >= 0 and coalesce(result_count,0) >= 0 and latency_ms >= 0
  ),
  constraint openai_usage_ledger_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);
create index openai_usage_ledger_created_at_idx on public.openai_usage_ledger (created_at);
create index openai_usage_ledger_operation_created_idx on public.openai_usage_ledger (operation, created_at);
create index openai_usage_ledger_model_created_idx on public.openai_usage_ledger (model, created_at);
create index openai_usage_ledger_source_created_idx on public.openai_usage_ledger (source_name, created_at);
alter table public.openai_usage_ledger enable row level security;
revoke all on public.openai_usage_ledger from public, anon, authenticated;
revoke all on sequence public.openai_usage_ledger_id_seq from public, anon, authenticated;
grant select, insert on public.openai_usage_ledger to service_role;
grant usage, select on sequence public.openai_usage_ledger_id_seq to service_role;
comment on table public.openai_usage_ledger is
  'Backend-only OpenAI API usage and estimated-cost ledger. Contains no complete prompts, credentials, cookies or auth headers.';
