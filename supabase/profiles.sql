-- MyMon — usernames.
-- Run this in the Supabase SQL Editor after schema.sql. Safe to run twice.
--
-- A username cannot live in user_metadata: that field is writable by its own
-- owner and has no way to enforce that two people do not pick the same name.
-- It needs a table with a unique constraint, which is what this file builds.

create table if not exists public.profiles (
  id         uuid        primary key
                         references auth.users (id) on delete cascade,

  -- Always stored lowercase, so "Victor" and "victor" cannot both be taken.
  -- Three to twenty characters, starting with a letter.
  username   text        not null unique
                         check (username ~ '^[a-z][a-z0-9_]{2,19}$'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security: your profile is yours to read and to change.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "read own profile"   on public.profiles;
drop policy if exists "create own profile" on public.profiles;
drop policy if exists "update own profile" on public.profiles;

create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "create own profile" on public.profiles
  for insert with check (auth.uid() = id);

create policy "update own profile" on public.profiles
  for update using (auth.uid() = id)
             with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Checking whether a name is free.
--
-- Nobody can read anyone else's row, so the app cannot answer this by looking.
-- This function answers yes or no and nothing else: it can see the whole table
-- (security definer), but all it ever returns is a single boolean, so it gives
-- away no usernames and no list of who exists.
-- ---------------------------------------------------------------------------
create or replace function public.username_available(candidate text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1 from public.profiles
    where username = lower(trim(candidate))
  );
$$;

revoke all on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Keep updated_at honest without trusting the browser to set it.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();
