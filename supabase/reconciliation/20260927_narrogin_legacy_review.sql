-- REVIEW-ONLY, MANUAL, REVERSIBLE historical reconciliation for Issue #46.
-- Do not run as an application migration. Run only after production backup,
-- row-count checks and explicit approval. It inserts mapping evidence only;
-- it never deletes or rewrites projects, scans, scan_projects or source URLs.
begin;
select id, name, developer, source_url from public.projects where id in (554, 570, 1563, 1564, 1565) order by id;
insert into public.project_reconciliations (legacy_project_id, canonical_project_id, reason, reviewed_at)
values
  (1563, 570, 'Reviewed Lightsource bp Narrogin East alias', now()),
  (1564, 570, 'Reviewed Lightsource bp Narrogin East contextual alias', now()),
  (1565, 554, 'Reviewed ACE Power/TagEnergy Narrogin Solar Farm contextual alias', now())
on conflict (legacy_project_id) do nothing;
select legacy_project_id, canonical_project_id, reason from public.project_reconciliations where legacy_project_id in (1563, 1564, 1565) order by legacy_project_id;
rollback;
