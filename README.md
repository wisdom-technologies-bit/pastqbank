# PastQ Bank

PastQ Bank is an internal API and admin dashboard for a Nigerian exam past-questions database.

## Environment variables

Set these names in your environment:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `BANK_SERVICE_API_KEY`

## Create the first admin

(a) In Supabase Dashboard > Authentication > Users, add a user with email and password.

(b) Run:

```sql
insert into public.bank_admins (user_id, email) select id, email from auth.users where email = 'YOUR_EMAIL';
```

(c) Log in at `/login`.
