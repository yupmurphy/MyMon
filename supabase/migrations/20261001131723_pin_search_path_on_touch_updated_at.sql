-- MyMon — tell the updated_at trigger where to look up names.
--
-- The function stamps profiles.updated_at whenever a profile changes. It did
-- not say where to find the names it uses, so in principle something placed
-- earlier on the lookup path could have answered in place of the real now().
-- Pinning search_path to nothing, and naming now() in full, closes that.
--
-- Small: the function runs with the caller's own permissions, not elevated
-- ones, so whoever wanted to fool it would already need rights an ordinary
-- signed-in user does not have. Tidying, not a hole being plugged.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

-- The trigger on public.profiles keeps pointing at this function; replacing a
-- function in place does not detach anything.
