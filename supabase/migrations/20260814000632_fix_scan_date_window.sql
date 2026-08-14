-- Preserve unknown announcement dates instead of turning discovery/import time
-- into a fabricated project announcement. No historical dates are rewritten.
alter table public.projects
  alter column announced_date drop not null,
  add column if not exists announced_date_evidence text,
  add column if not exists last_seen_at timestamptz;

alter table public.scans
  add column if not exists start_date date,
  add column if not exists end_date date;

alter table public.scan_projects
  add column if not exists effective_date date,
  add column if not exists date_evidence text not null default 'unknown';

alter table public.scans
  add constraint scans_date_window_order_check
  check (start_date is null or end_date is null or start_date <= end_date);

create index if not exists scan_projects_window_idx
  on public.scan_projects(scan_id, effective_date, is_new);

comment on column public.projects.announced_date is
  'Source-supported project announcement/event date; null when the source does not provide one.';
comment on column public.projects.announced_date_evidence is
  'Date provenance such as source_reported; null marks legacy/unclassified rows.';
comment on column public.projects.last_seen_at is
  'Most recent source rediscovery, separate from the project announcement date.';
comment on column public.scan_projects.effective_date is
  'Announcement/event date used by the authoritative scan-window decision.';
