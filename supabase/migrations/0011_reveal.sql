-- Reveal: a practice student may see the correct answer without answering.
-- A revealed row keeps selected_option null, so it stays unanswered for scoring.
alter table public.exam_session_answers add column if not exists revealed_at timestamptz;
