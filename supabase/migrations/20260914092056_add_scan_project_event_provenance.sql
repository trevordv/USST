alter table public.scan_projects
  add column if not exists event_type text,
  add column if not exists source_url text,
  add column if not exists source_name text;

update public.scan_projects
set event_type = case
  when is_new then 'new'
  when date_evidence = 'altenergy_watts_news_update' then 'updated'
  when date_evidence = 'altenergy_inventory_observation' then 'inventory_observed'
  when effective_date is not null then 'updated'
  else 'inventory_observed'
end
where event_type is null;

alter table public.scan_projects
  alter column event_type set default 'inventory_observed',
  alter column event_type set not null;

alter table public.scan_projects
  add constraint scan_projects_event_type_check
  check (event_type in ('new', 'updated', 'inventory_observed'));

comment on column public.scan_projects.event_type is
  'How the canonical project relates to this scan; does not redefine is_new.';
comment on column public.scan_projects.source_url is
  'Event-level source URL, which may differ from the canonical project source URL.';
