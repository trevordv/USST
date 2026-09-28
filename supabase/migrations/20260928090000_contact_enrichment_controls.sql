-- Backend-only contact enrichment controls and audit lineage. This migration
-- does not rewrite or delete any existing project/contact data.
alter table public.contact_enrichments
  add column verified_contacts integer not null default 0,
  add column tentative_leads integer not null default 0,
  add column rejected_matches integer not null default 0,
  add column projects_updated integer not null default 0,
  add column provider_requests integer not null default 0,
  add column credits_estimated integer not null default 0,
  add column credits_consumed integer not null default 0,
  add column approved_credit_budget integer not null default 0,
  add column paid_prospecting_approved boolean not null default false,
  add column dry_run boolean not null default false,
  add constraint contact_enrichments_metrics_nonnegative check (
    verified_contacts >= 0 and tentative_leads >= 0 and rejected_matches >= 0 and
    projects_updated >= 0 and provider_requests >= 0 and credits_estimated >= 0 and
    credits_consumed >= 0 and approved_credit_budget >= 0
  );

create table public.contact_enrichment_attempts (
  id serial primary key,
  provider text not null,
  developer_key text not null,
  status text not null,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz not null default now(),
  next_eligible_at timestamptz,
  last_run_id integer references public.contact_enrichments(id) on delete set null,
  failure_category text,
  updated_at timestamptz not null default now(),
  constraint contact_enrichment_attempt_provider_developer_uidx unique (provider, developer_key),
  constraint contact_enrichment_attempt_count_check check (attempt_count >= 0)
);
create index contact_enrichment_attempt_provider_next_idx on public.contact_enrichment_attempts (provider, next_eligible_at);

create table public.contact_enrichment_provenance (
  id serial primary key,
  run_id integer not null references public.contact_enrichments(id) on delete cascade,
  project_id integer not null references public.projects(id) on delete cascade,
  developer_key text not null,
  provider text not null,
  verification_status text not null,
  validation_reason text,
  source_url text,
  contact_fingerprint text,
  credits_consumed integer not null default 0,
  created_at timestamptz not null default now(),
  constraint contact_enrichment_provenance_status_check check (verification_status in ('verified', 'tentative', 'rejected')),
  constraint contact_enrichment_provenance_credit_check check (credits_consumed >= 0),
  constraint contact_enrichment_provenance_fingerprint_check check (
    contact_fingerprint is null or contact_fingerprint ~ '^[a-f0-9]{64}$'
  )
);
create index contact_enrichment_provenance_run_idx on public.contact_enrichment_provenance (run_id);

alter table public.contact_enrichment_attempts enable row level security;
alter table public.contact_enrichment_provenance enable row level security;
revoke all on public.contact_enrichment_attempts, public.contact_enrichment_provenance from public, anon, authenticated;
revoke all on sequence public.contact_enrichment_attempts_id_seq, public.contact_enrichment_provenance_id_seq from public, anon, authenticated;
grant select, insert, update on public.contact_enrichment_attempts, public.contact_enrichment_provenance to service_role;
grant usage, select on sequence public.contact_enrichment_attempts_id_seq, public.contact_enrichment_provenance_id_seq to service_role;

comment on table public.contact_enrichment_attempts is 'Backend-owned provider attempt/cooldown state; contains no contact PII or provider response bodies.';
comment on table public.contact_enrichment_provenance is 'Backend-owned verification lineage using a one-way contact fingerprint; contains no raw provider response body.';
