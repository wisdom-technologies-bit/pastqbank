drop index if exists public.exam_sessions_client_ref_idx;
alter table public.exam_sessions add column if not exists idempotency_key text;
create unique index if not exists exam_sessions_user_idempotency_key_idx on public.exam_sessions(user_ref,idempotency_key) where idempotency_key is not null;
create index if not exists exam_sessions_active_user_idx on public.exam_sessions(user_ref) where status in ('created','in_progress');
