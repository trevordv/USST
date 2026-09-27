-- Additive/reversible lineage support for Issue #46. This migration intentionally
-- does not update, delete, merge, or otherwise alter historical production rows.
create table if not exists public.project_source_events (
  id serial primary key,
  canonical_project_id integer not null references public.projects(id),
  source_url text not null,
  event_date date not null,
  source_name text not null,
  created_at timestamptz not null default now(),
  constraint project_source_events_identity_unique unique (canonical_project_id, source_url, event_date)
);

create table if not exists public.project_reconciliations (
  id serial primary key,
  legacy_project_id integer not null references public.projects(id),
  canonical_project_id integer not null references public.projects(id),
  reason text not null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint project_reconciliations_legacy_unique unique (legacy_project_id),
  constraint project_reconciliations_not_self check (legacy_project_id <> canonical_project_id)
);

alter table public.project_source_events enable row level security;
alter table public.project_reconciliations enable row level security;
revoke all on public.project_source_events, public.project_reconciliations from public, anon, authenticated;
revoke all on sequence public.project_source_events_id_seq, public.project_reconciliations_id_seq from public, anon, authenticated;
grant select, insert on public.project_source_events to service_role;
grant select, insert on public.project_reconciliations to service_role;
grant usage, select on sequence public.project_source_events_id_seq, public.project_reconciliations_id_seq to service_role;

comment on table public.project_source_events is 'Canonical source-event deduplication ledger. It preserves source articles and does not replace scan lineage.';
comment on table public.project_reconciliations is 'Additive, reversible legacy-to-canonical mapping. No historical project, scan lineage or evidence is deleted.';
