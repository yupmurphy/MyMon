-- MyMon — take the trigger functions off the public API.
--
-- Supabase publishes every function in the public schema as a web address, so
-- anything that lives there is callable unless it is told not to be. The
-- groups migration remembered that for the five little yes/no helpers and
-- forgot it for the three triggers — Supabase's own linter spotted the
-- inconsistency, which is what this file settles.
--
-- Nothing was actually open. Postgres refuses to run a trigger function as an
-- ordinary call ("trigger functions can only be called as triggers"), so the
-- address led nowhere. But these three run with raised permissions and nobody
-- has any reason to call them, so the permission is better gone than
-- explained.
--
-- Triggers keep working: Postgres checks who may execute the function when the
-- trigger is *created*, not every time a row is written. Both halves were
-- re-tested after this ran — the owner still joins their own new group
-- automatically, and the guard still refuses to let an owner walk out.
--
-- Safe to run again: revoking a permission that is already gone does nothing.

revoke all on function public.guard_group_membership() from public, anon, authenticated;
revoke all on function public.guard_group_expense()    from public, anon, authenticated;
revoke all on function public.join_own_group()         from public, anon, authenticated;

-- The other five stay callable by signed-in users on purpose. A rule written
-- with is_group_member(...) in it is evaluated as whoever is running the
-- query, so that person needs to be allowed to run the function — take the
-- permission away and the rule stops working, and with it the whole feature.
-- Each one answers a single yes or no about the person asking, and gives away
-- no names and no lists.
