# PastQ Bank

PastQ Bank is an internal API and admin dashboard for a Nigerian exam past-questions database.

## Environment variables

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `BANK_SERVICE_API_KEY`.

## Migrations

Schema changes are recorded in `supabase/migrations/0001_bank_admins.sql` and `0002_bank_schema.sql`.

Tables: bank_admins, providers, provider_keys, exams, subjects, topics, questions, import_jobs, import_units, import_errors, exam_sessions, exam_session_questions, exam_session_answers, admin_audit_logs.

External cron-job.org routes must send `Authorization: Bearer <CRON_SECRET>`.

## First admin

(a) In Supabase Dashboard > Authentication > Users, add a user with email and password.
(b) Run: insert into public.bank_admins (user_id, email) select id, email from auth.users where email = 'YOUR_EMAIL';
(c) Log in at /login.
