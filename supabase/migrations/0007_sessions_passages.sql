-- Prompt B2: sessions, passage grouping, and secure presentation.
alter table public.exam_sessions rename column client_ref to user_ref;
alter table public.exam_sessions alter column user_ref set not null;
alter table public.exam_sessions alter column mode drop default;
alter table public.exam_sessions alter column status drop default;
alter table public.exam_sessions drop constraint if exists exam_sessions_mode_check;
alter table public.exam_sessions drop constraint if exists exam_sessions_status_check;
alter table public.exam_sessions add constraint exam_sessions_mode_check check (mode in ('practice','cbt'));
alter table public.exam_sessions add constraint exam_sessions_status_check check (status in ('created','in_progress','submitted','expired'));
alter table public.exam_sessions add column if not exists exam_slug text;
alter table public.exam_sessions add column if not exists exam_year integer;
alter table public.exam_sessions add column if not exists tier text not null default 'free' check (tier in ('free','premium'));
alter table public.exam_sessions add column if not exists total_questions integer not null default 0;
alter table public.exam_sessions add column if not exists feedback_mode text not null default 'instant' check (feedback_mode in ('instant','end'));
alter table public.exam_sessions add column if not exists expires_at timestamptz not null default (now() + interval '24 hours');
alter table public.exam_sessions alter column started_at drop not null;
update public.exam_sessions set mode=case when mode='exam' then 'cbt' else 'practice' end, status=case when status='active' then 'in_progress' else status end;
create index if not exists exam_sessions_user_ref_idx on public.exam_sessions(user_ref);
create index if not exists exam_sessions_status_idx on public.exam_sessions(status);

alter table public.exam_session_questions add column if not exists id uuid default gen_random_uuid();
alter table public.exam_session_questions alter column id set not null;
alter table public.exam_session_questions add column if not exists subject_slug text;
alter table public.exam_session_questions add column if not exists subject_number integer;
alter table public.exam_session_questions add column if not exists passage_key text;
alter table public.exam_session_questions add column if not exists borrowed_from_year integer;
alter table public.exam_session_questions drop constraint if exists exam_session_questions_pkey;
alter table public.exam_session_questions add primary key (id);
create unique index if not exists exam_session_questions_session_position_key on public.exam_session_questions(session_id, position);
create index if not exists exam_session_questions_session_idx on public.exam_session_questions(session_id);

alter table public.questions add column if not exists passage_key text;
create index if not exists questions_passage_key_idx on public.questions(passage_key);

-- Passage categories are stable only when their question numbers form a contiguous group
-- and the normalized section text is identical; otherwise use a content-derived key.
with grouped as (
  select exam_id, subject_id, exam_year, raw_payload->>'category' category,
    count(*) group_count, min(question_number) min_q, max(question_number) max_q,
    count(distinct regexp_replace(coalesce(section,''), '\\s+', ' ', 'g')) text_count,
    min(regexp_replace(coalesce(section,''), '\\s+', ' ', 'g')) passage_text
  from public.questions where has_passage
  group by exam_id, subject_id, exam_year, raw_payload->>'category'
)
update public.questions q set passage_key=case when g.max_q-g.min_q+1=g.group_count and g.text_count=1 and g.group_count>=2 then concat(g.exam_id,':',g.subject_id,':',g.exam_year,':',g.category) else md5(concat(g.exam_id,':',g.subject_id,':',g.exam_year,':',g.passage_text)) end
from grouped g where q.has_passage and q.exam_id=g.exam_id and q.subject_id=g.subject_id and q.exam_year=g.exam_year and q.raw_payload->>'category'=g.category;

alter table public.exam_sessions enable row level security;
alter table public.exam_session_questions enable row level security;
alter table public.exam_session_answers enable row level security;
revoke all on public.exam_sessions, public.exam_session_questions, public.exam_session_answers from anon, authenticated;

create or replace function public.create_exam_session(p_session jsonb, p_questions jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
  insert into public.exam_sessions (user_ref,mode,exam_slug,exam_year,tier,status,config,total_questions,duration_seconds,feedback_mode,expires_at)
  values (p_session->>'user_ref',p_session->>'mode',p_session->>'exam_slug',nullif(p_session->>'exam_year','')::int,p_session->>'tier','created',p_session->'config',(p_session->>'total_questions')::int,nullif(p_session->>'duration_seconds','')::int,p_session->>'feedback_mode',now()+interval '24 hours') returning id into sid;
  insert into public.exam_session_questions (id,session_id,position,question_id,subject_slug,subject_number,passage_key,borrowed_from_year)
  select coalesce((x->>'ref')::uuid,gen_random_uuid()),sid,(x->>'position')::int,(x->>'question_id')::uuid,x->>'subject_slug',(x->>'subject_number')::int,x->>'passage_key',nullif(x->>'borrowed_from_year','')::int from jsonb_array_elements(p_questions) x;
  return sid;
end $$;
revoke all on function public.create_exam_session(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_exam_session(jsonb,jsonb) to service_role;
