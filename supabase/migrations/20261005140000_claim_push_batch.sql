-- MyMon — handing a batch of notifications to whatever does the sending.
--
-- Why claiming and reading are one step
-- -------------------------------------
-- The sender runs on a timer. If it read a batch, sent it, and only then
-- marked the rows, two runs that overlap would both read the same rows and
-- everybody would get every notification twice. Phones buzzing twice is the
-- failure people actually notice and turn the feature off over.
--
-- So this stamps first and hands back what it stamped. The trade is deliberate
-- and goes the other way: if the sending fails after this returns, that buzz
-- is simply lost. The notification itself is untouched and still waiting in
-- the bell, so nothing is forgotten — only the nudge. A missed nudge is a far
-- smaller harm than a duplicated one.
--
-- `for update skip locked` is what makes two runs at the same instant take
-- different rows instead of one of them waiting for the other.
--
-- Who may call it
-- ---------------
-- `service_role` and nobody else. A signed-in browser calling this would mark
-- everybody's notifications as sent — not a leak, but a silent way to make the
-- whole feature stop working. It is not granted to `authenticated` at all.

create or replace function public.claim_push_batch(how_many int default 50)
returns table (
  notification_id uuid,
  user_id         uuid,
  kind            text,
  group_id        uuid,
  entry_id        uuid,
  created_at      timestamptz,
  actor_name      text,
  group_name      text
)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with picked as (
    select n.id
      from public.notifications n
     where n.pushed_at is null
     order by n.created_at
     limit greatest(1, least(how_many, 200))
       for update skip locked
  ),
  claimed as (
    update public.notifications n
       set pushed_at = now()
      from picked
     where n.id = picked.id
    returning n.id, n.user_id, n.kind, n.actor_id, n.group_id,
              n.entry_id, n.created_at
  )
  select c.id,
         c.user_id,
         c.kind,
         c.group_id,
         c.entry_id,
         c.created_at,

         -- The same order the bell uses: a real name if there is one, the
         -- username if not, and a word rather than a blank if the account is
         -- gone. A notification that says "commented" with nobody in front of
         -- it is worse than one that says "Somebody".
         coalesce(
           nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
           '@' || p.username,
           'Somebody'
         ),
         coalesce(g.name, 'a group')
    from claimed c
    left join public.profiles p on p.id = c.actor_id
    left join public.groups   g on g.id = c.group_id;
end;
$$;

-- `least` and `greatest` are SQL grammar rather than functions, so they cannot
-- be schema-qualified and cannot be shadowed either — bare is both necessary
-- and safe under `search_path = ''`.

revoke all on function public.claim_push_batch(int) from public, anon, authenticated;
grant execute on function public.claim_push_batch(int) to service_role;
