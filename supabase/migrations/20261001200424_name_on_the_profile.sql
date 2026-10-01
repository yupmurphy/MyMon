-- MyMon — put the display name where other people can read it.
--
-- The name you type in Settings lives on the account itself, in the metadata
-- Supabase keeps beside your sign-in. That is the right place for it in a solo
-- app and the wrong place the moment there are groups: nobody can read anybody
-- else's account record, so a group could only ever say "sandaletta" where it
-- wanted to say "Ana Popescu".
--
-- So the name is mirrored onto the profile, which already has a rule saying
-- who may read it: yourself, and whoever shares a group with you. Nothing is
-- opened to the world — the row was already readable by exactly those people
-- (see 20261001145917), and this only adds two more columns to what they see.
--
-- The account keeps its copy. It is what greets you by name before any profile
-- has been fetched, and it is what a fresh install reads first.
--
-- Both columns are allowed to be empty: a username is required to be in a
-- group, a real name never is.

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name  text;

-- Written out longhand because "add column if not exists ... check (...)" would
-- quietly skip the constraint on a second run, when the column is already
-- there. Named, so there is something to look for.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_first_name_len') then
    alter table public.profiles
      add constraint profiles_first_name_len check (char_length(first_name) <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_last_name_len') then
    alter table public.profiles
      add constraint profiles_last_name_len check (char_length(last_name) <= 40);
  end if;
end
$$;

-- Everyone who already has a profile gets the name their account is carrying,
-- so nobody has to go and re-type something they typed months ago.
--
-- Safe to run again, with one wrinkle worth knowing: it only fills rows where
-- both columns are empty, so it cannot overwrite a name somebody has set. It
-- could, however, put a name back for somebody who deliberately cleared theirs
-- and left it blank in Settings. That is the only way to be wrong here, and it
-- restores something they typed themselves rather than inventing anything.
update public.profiles p
   set first_name = nullif(btrim(u.raw_user_meta_data ->> 'first_name'), ''),
       last_name  = nullif(btrim(u.raw_user_meta_data ->> 'last_name'), '')
  from auth.users u
 where u.id = p.id
   and p.first_name is null
   and p.last_name is null;

-- ---------------------------------------------------------------------------
-- Keeping the two copies together afterwards is the app's job, not a trigger's:
-- Settings writes the account and the profile in the same breath. A trigger on
-- auth.users would reach across into Supabase's own schema to do it, which is
-- a great deal more machinery for a field that changes about twice a year.
--
--   select username, first_name, last_name from public.profiles;
-- ---------------------------------------------------------------------------
