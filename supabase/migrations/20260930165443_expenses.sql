-- MyMon — the expenses table. The first migration: everything else builds
-- on this one.
--
-- Creates only what is missing, so running it again changes nothing.

-- ---------------------------------------------------------------------------
-- The one table: an expense belongs to exactly one user.
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id          uuid        primary key default gen_random_uuid(),

  -- Filled in automatically from whoever is signed in, so the browser never
  -- gets to claim it is someone else.
  user_id     uuid        not null default auth.uid()
                          references auth.users (id) on delete cascade,

  amount      numeric(10, 2) not null
                          check (amount >= 0.01 and amount <= 999999.99),

  category    text        not null
                          check (category in ('food', 'bills', 'transport',
                                              'entertainment', 'hobby',
                                              'other', 'shopping')),

  spent_on    date        not null,

  comment     text        not null default ''
                          check (char_length(comment) <= 140),

  created_at  timestamptz not null default now()
);

-- Reading one month for one person is the only query the app makes.
create index if not exists transactions_user_date_idx
  on public.transactions (user_id, spent_on desc);

-- ---------------------------------------------------------------------------
-- Row Level Security: without this, anyone could read everyone's expenses.
-- The rules below are what keeps one person's money out of another's screen.
-- ---------------------------------------------------------------------------
alter table public.transactions enable row level security;

drop policy if exists "read own expenses"   on public.transactions;
drop policy if exists "add own expenses"    on public.transactions;
drop policy if exists "edit own expenses"   on public.transactions;
drop policy if exists "delete own expenses" on public.transactions;

create policy "read own expenses" on public.transactions
  for select using (auth.uid() = user_id);

create policy "add own expenses" on public.transactions
  for insert with check (auth.uid() = user_id);

create policy "edit own expenses" on public.transactions
  for update using (auth.uid() = user_id)
             with check (auth.uid() = user_id);

create policy "delete own expenses" on public.transactions
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- A quick check. After running everything, this should return no rows and no
-- error while signed out — proof that the table is not readable by strangers.
--   select * from public.transactions;
-- ---------------------------------------------------------------------------
