-- B3c: unanswered rows must never be marked correct.
alter table public.exam_session_answers add column if not exists is_correct boolean not null default false;
update public.exam_session_answers set is_correct = false where selected_option is null;
