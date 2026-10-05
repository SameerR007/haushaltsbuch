/**
 * Same script as `supabase/setup.sql`. Inlined so the API bundle does not
 * depend on reading the file at runtime. The unit test keeps the two copies
 * identical.
 */
export const SETUP_SQL = `-- Haushaltsbuch schema. Safe to run more than once.
-- Seeds categories and a default EUR preference. No sample banks or transactions.
-- Single-user local app: the anon key is the household credential. No Supabase Auth.

create table if not exists public.categories (
  name text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.banks (
  name text primary key,
  initials text not null check (char_length(initials) between 1 and 4),
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id bigint generated always as identity primary key,
  date date not null,
  category text not null references public.categories (name),
  amount numeric(12, 2) not null,
  bank text not null references public.banks (name),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.preferences (
  id integer primary key default 1 check (id = 1),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$')
);

insert into public.categories (name)
values
  ('food'),
  ('rent'),
  ('household'),
  ('grocery'),
  ('bill'),
  ('miscellaneous'),
  ('salary')
on conflict (name) do nothing;

insert into public.preferences (id, currency)
values (1, 'EUR')
on conflict (id) do nothing;

grant usage on schema public to anon, service_role;

grant select, insert, update, delete on table public.categories to anon, service_role;
grant select, insert, update, delete on table public.banks to anon, service_role;
grant select, insert, update, delete on table public.transactions to anon, service_role;
grant select, insert, update, delete on table public.preferences to anon, service_role;

grant usage, select on all sequences in schema public to anon, service_role;

alter table public.categories enable row level security;
alter table public.banks enable row level security;
alter table public.transactions enable row level security;
alter table public.preferences enable row level security;

create policy if not exists household_anon_all on public.categories
  for all to anon using (true) with check (true);

create policy if not exists household_anon_all on public.banks
  for all to anon using (true) with check (true);

create policy if not exists household_anon_all on public.transactions
  for all to anon using (true) with check (true);

create policy if not exists household_anon_all on public.preferences
  for all to anon using (true) with check (true);

notify pgrst, 'reload schema';
`;

/** Idempotent setup script. Not a secret. */
export function loadSetupSql(): string {
  return SETUP_SQL;
}
