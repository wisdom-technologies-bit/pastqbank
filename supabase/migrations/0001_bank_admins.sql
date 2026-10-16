create table if not exists public.bank_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);
alter table public.bank_admins enable row level security;
-- Intentionally NO policies: only the service-role key may read or write this table.
