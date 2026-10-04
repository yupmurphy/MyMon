-- MyMon — the handle on a friend request.
--
-- A consequence of the asymmetry in the previous migration, found while
-- building the screen rather than while designing the table.
--
-- Until somebody accepts, the person who asked cannot read their profile — on
-- purpose: a real name is the other person's to give. But that leaves the
-- asker's own "waiting" list showing a row with nobody in it. You would see
-- that you had asked *someone*, and not who.
--
-- The honest fix is not to widen what the asker may read. It is to notice that
-- the asker already knows the username — they typed it — and simply write it
-- down. Nothing new is disclosed to anybody: the column is on a row only the
-- two of them can read, and it holds a string one of them supplied.

alter table public.friendships
  add column if not exists asked_handle text;

comment on column public.friendships.asked_handle is
  'The username that was typed, resolved to its canonical form. Here so the '
  'asker can see who they are waiting on without being able to read that '
  'person''s profile before they accept.';

-- Rewritten only to fill the new column. Everything else is as it was.
create or replace function public.ask_to_be_friends(candidate text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me       uuid := auth.uid();
  target   uuid;
  handle   text;
  lo       uuid;
  hi       uuid;
  standing text;
  asker    uuid;
begin
  if me is null then return 'not_signed_in'; end if;

  select p.id, p.username into target, handle
    from public.profiles p
   where p.username = pg_catalog.lower(pg_catalog.btrim(candidate));

  if target is null then return 'no_such_user'; end if;
  if target = me    then return 'self';         end if;

  -- least/greatest are bare on purpose. Everything else here is qualified
  -- against search_path = '', but these two are SQL grammar rather than
  -- functions — pg_catalog.least() is not a thing, and nothing can shadow
  -- them either.
  lo := least(me, target);
  hi := greatest(me, target);

  select f.state, f.asked_by into standing, asker
    from public.friendships f
   where f.low_id = lo and f.high_id = hi;

  if standing = 'accepted' then return 'already_friends'; end if;
  if standing = 'pending' then
    -- They asked first. Saying "ask" when the answer is "accept" would be a
    -- loop nobody can get out of, so the caller is told which it is.
    if asker = target then return 'they_asked_you'; end if;
    return 'already_asked';
  end if;

  insert into public.friendships (low_id, high_id, state, asked_by, asked_handle)
  values (lo, hi, 'pending', me, handle);

  return 'asked';

exception
  -- Both of you pressed add in the same second. The pair is the primary key,
  -- so one insert won and this one is the loser — which means the row that
  -- exists is theirs, and the right thing to show is "accept", not "asked".
  when unique_violation then
    return 'they_asked_you';
end;
$$;

-- The guard froze the identity columns by name, so it does not need changing —
-- but asked_handle is identity too: letting it be rewritten would let somebody
-- relabel who they had asked. Freeze it with the rest.
create or replace function public.guard_friendship()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.low_id       is distinct from old.low_id
  or new.high_id      is distinct from old.high_id
  or new.asked_by     is distinct from old.asked_by
  or new.asked_handle is distinct from old.asked_handle
  or new.created_at   is distinct from old.created_at then
    raise exception 'a friendship cannot be rewritten, only answered';
  end if;

  if old.state = 'accepted' then
    raise exception 'this is already a friendship';
  end if;

  if new.state <> 'accepted' then
    raise exception 'the only answer that changes a row is yes';
  end if;

  -- The one that matters: the person who asked is not the person who answers.
  if auth.uid() = old.asked_by then
    raise exception 'you cannot accept your own request';
  end if;

  new.answered_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.guard_friendship()      from public, anon, authenticated;
revoke all on function public.ask_to_be_friends(text) from public, anon;
grant execute on function public.ask_to_be_friends(text) to authenticated;
