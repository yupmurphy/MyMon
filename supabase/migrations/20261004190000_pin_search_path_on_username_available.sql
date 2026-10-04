-- MyMon — bring the last function into line with the other nine.
--
-- Every security definer function in this database pins search_path to
-- nothing and spells the names it uses in full, so that nothing placed
-- earlier on the lookup path can answer in place of the real function. This
-- one was written before that rule existed and was left at
-- `search_path = public`.
--
-- To be exact about the risk: this is not a hole. Postgres searches
-- pg_catalog first whether or not you name it, so `lower` and `trim` here
-- have always resolved to the built-ins. It is the odd one out of ten, and an
-- odd one out is how the next person learns the wrong habit.
--
-- Nothing about what it answers changes.

create or replace function public.username_available(candidate text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select not exists (
    select 1 from public.profiles
    where username = pg_catalog.lower(pg_catalog.btrim(candidate))
  );
$$;

revoke all on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;
