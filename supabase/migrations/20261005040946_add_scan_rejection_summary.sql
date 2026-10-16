alter table public.scans
  add column if not exists rejection_summary jsonb;

comment on column public.scans.rejection_summary is
  'Scan-wide quality-gate rejection breakdown for this scan only (counts by reason, plus the sources losing the most to a missing capacity figure). Null for scans run before this column existed.';
