alter table public.import_units
  drop constraint if exists import_units_job_id_exam_slug_exam_year_key;

drop index if exists public.import_units_job_id_exam_slug_exam_year_key;

create unique index import_units_job_exam_year_subject_uq
  on public.import_units (job_id, exam_slug, exam_year, coalesce(subject_slug, ''));

alter table public.import_jobs
  add column if not exists plan_cursor_year int;

delete from public.admin_audit_logs
where action = 'auto_import_bootstrap';
