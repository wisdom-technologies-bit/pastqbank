alter table public.import_units
  drop constraint if exists import_units_status_check;

alter table public.import_units
  add constraint import_units_status_check
  check (status = any (array['queued'::text, 'pending'::text, 'running'::text, 'done'::text, 'empty'::text, 'failed'::text, 'skipped'::text]));
