alter table import_units add column if not exists subject_slug text;
create index if not exists import_units_job_status_idx on import_units (job_id, status);
