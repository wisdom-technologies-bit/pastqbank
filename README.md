# PastQ Bank

PastQ Bank is an internal API and admin dashboard for a Nigerian exam past-questions database.

## Environment variables

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `BANK_SERVICE_API_KEY`.

## Migrations

Schema changes are recorded in `supabase/migrations/0001_bank_admins.sql` and `0002_bank_schema.sql`.

Tables: bank_admins, providers, provider_keys, exams, subjects, topics, questions, import_jobs, import_units, import_errors, exam_sessions, exam_session_questions, exam_session_answers, admin_audit_logs.

External cron-job.org routes must send `Authorization: Bearer <CRON_SECRET>`.

## ALOC API keys

Configure keys as `ALOC_API_KEY_1`, `ALOC_API_KEY_2`, and so on. Keys are sorted numerically, rotated when invalid or out of credits, and cooled after rate limits or low rate-limit headers. Exhausted keys are reset to active at the start of the next UTC month; low-credit threshold is configurable with `ALOC_LOW_CREDIT_THRESHOLD`. Keys are discovered at runtime and their secrets are never stored in the database or logged; `provider_keys` stores only the environment-variable name and operational status.

## Import pipeline

ALOC imports sanitise rich text, normalise catalog fields, validate required content, deduplicate by source and content hash, then save published or quarantined rows. Quarantine reasons include `text_empty`, `missing_required_option:X`, `duplicate_option_text`, `answer_missing`, `answer_not_in_options`, `passage_missing`, `bad_image_url`, `bad_year`, and `duplicate_content`. Re-running the same import is idempotent; quarantined and archived questions are never served.

## Import engine

Imports are autonomous: start one job once from `/admin/imports`, then configure cron-job.org to POST `/api/cron/import-worker` every minute with `Authorization: Bearer <CRON_SECRET>`. Each response contains per-request pages, credits, attempts, remaining credits, and keys used. Slices release queued jobs after budget/rate-limit/transient stops, resume from the stored cursor, process newest years and exams in deterministic order, and automatically resume an exhausted-key pause when keys become available. Coverage windows skip known-empty years without an ALOC request. Use “Import everything (newest to oldest)” to create the full 1988-to-current range.

## First admin

(a) In Supabase Dashboard > Authentication > Users, add a user with email and password.
(b) Run: insert into public.bank_admins (user_id, email) select id, email from auth.users where email = 'YOUR_EMAIL';
(c) Log in at /login.
