-- MyMon — friends.
--
-- Why this exists
-- ---------------
-- Today you invite somebody to a group by typing their username from memory.
-- That works exactly once — the first time, when you asked them what it was.
-- A friends list is the memory.
--
-- The shape: one row per pair, not two
-- ------------------------------------
-- A friendship is mutual, so storing it twice (A→B and B→A) means every read
-- has to look both ways and every write has to keep two rows agreeing. Worse,
-- two people pressing "add" at the same moment would create two rows that each
-- think they are the request.
--
-- Instead there is **one row per pair**, with the two ids always stored in the
-- same order — the smaller uuid in low_id, the larger in high_id. That makes
-- the pair the primary key, so the database itself refuses a duplicate. "Are
-- we already friends?" and "did one of us already ask?" become the same
-- question, and it has one answer.
--
-- Who may write one
-- -----------------
-- Nobody, directly. There is no insert policy. A request is made through
-- public.ask_to_be_friends below, which takes a *username* and never hands the
-- browser anybody's account id — the same bargain group invitations already
-- make. Accepting and removing are ordinary updates and deletes on a row you
-- are part of, policed by the trigger.

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  low_id      uuid        not null references auth.users (id) on delete cascade,
  high_id     uuid        not null references auth.users (id) on delete cascade,

  state       text        not null check (state in ('pending', 'accepted')),

  -- Which of the two asked. This is what stops you accepting your own request.
  asked_by    uuid        not null references auth.users (id) on delete cascade,

  created_at  timestamptz not null default now(),
  answered_at timestamptz,

  primary key (low_id, high_id),

  -- The ordering is the whole trick, so the database insists on it rather than
  -- trusting every writer to remember. It also rules out befriending yourself.
  constraint friendship_is_ordered check (low_id < high_id),

  -- And the asker has to be one of the two people in it.
  constraint friendship_asker_is_in_it check (asked_by in (low_id, high_id))
);

-- "Who are my friends", asked on every dashboard load, from either side.
create index if not exists friendships_low_idx  on public.friendships (low_id);
create index if not exists friendships_high_idx on public.friendships (high_id);

alter table public.friendships enable row level security;

-- ---------------------------------------------------------------------------
-- 2. The rules.
--
-- Read a row you are in. Answer one. Remove one. No insert policy: see above.
-- ---------------------------------------------------------------------------
drop policy if exists "read my friendships"   on public.friendships;
drop policy if exists "answer a friendship"   on public.friendships;
drop policy if exists "remove a friendship"   on public.friendships;

create policy "read my friendships" on public.friendships
  for select using (auth.uid() in (low_id, high_id));

create policy "answer a friendship" on public.friendships
  for update using (auth.uid() in (low_id, high_id))
             with check (auth.uid() in (low_id, high_id));

-- One policy covers three things that are the same act: declining a request,
-- taking back one you sent, and unfriending. Each is "this row should not
-- exist", and each is allowed to either person.
create policy "remove a friendship" on public.friendships
  for delete using (auth.uid() in (low_id, high_id));

-- ---------------------------------------------------------------------------
-- 3. An update may only ever be an acceptance.
--
-- The policy above lets you update a row you are in, and a policy cannot see
-- what the row looked like before. Without this, "accept" would also be
-- "rewrite who asked whom", and you could accept your own request and award
-- yourself a friend. A trigger can see OLD, so it does the part RLS cannot.
-- ---------------------------------------------------------------------------
create or replace function public.guard_friendship()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.low_id     is distinct from old.low_id
  or new.high_id    is distinct from old.high_id
  or new.asked_by   is distinct from old.asked_by
  or new.created_at is distinct from old.created_at then
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

drop trigger if exists guard_friendship on public.friendships;
create trigger guard_friendship
  before update on public.friendships
  for each row execute function public.guard_friendship();

-- ---------------------------------------------------------------------------
-- 4. Asking.
--
-- Takes a username and returns a word. The browser never learns an account id
-- it did not already have, and never learns whether a username exists except
-- by asking to be friends with it — which is a thing you can only do on
-- purpose, one name at a time.
-- ---------------------------------------------------------------------------
create or replace function public.ask_to_be_friends(candidate text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me       uuid := auth.uid();
  target   uuid;
  lo       uuid;
  hi       uuid;
  standing text;
  asker    uuid;
begin
  if me is null then return 'not_signed_in'; end if;

  select p.id into target from public.profiles p
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

  insert into public.friendships (low_id, high_id, state, asked_by)
  values (lo, hi, 'pending', me);

  return 'asked';

exception
  -- Both of you pressed add in the same second. The pair is the primary key,
  -- so one insert won and this one is the loser — which means the row that
  -- exists is theirs, and the right thing to show is "accept", not "asked".
  when unique_violation then
    return 'they_asked_you';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Seeing a friend's name.
--
-- Until now a profile was readable by you and by anybody who shares a group
-- with you. A friend who shares no group would have been a row of blanks.
--
-- The asymmetry is deliberate. The person being asked can read the asker's
-- profile, because they have to know who is asking before they can answer.
-- The asker cannot read theirs until they say yes — the asker already knows
-- the username, they typed it, and a real name is the invitee's to give.
-- ---------------------------------------------------------------------------
create or replace function public.friends_with(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships f
     where f.low_id = least(auth.uid(), other)
       and f.high_id = greatest(auth.uid(), other)
       and (f.state = 'accepted' or f.asked_by = other)
  );
$$;

drop policy if exists "read profiles of my friends" on public.profiles;
create policy "read profiles of my friends" on public.profiles
  for select using (public.friends_with(id));

-- ---------------------------------------------------------------------------
-- 6. The bell learns two more words.
--
-- 'friend_request'  somebody asked to be your friend
-- 'friend_accepted' somebody you asked said yes
--
-- Both ride on actor_id, which the table already has; there is nothing to
-- point at but the person.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists notify_friend boolean not null default true;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('group_invite', 'group_comment', 'comment_on_mine',
                  'friend_request', 'friend_accepted'));

-- Being asked twice by the same person should not ring twice. The group
-- version of this guard keys on the group; this one keys on the person, since
-- that is all a friend request is about.
create unique index if not exists notifications_one_friend_request_idx
  on public.notifications (user_id, actor_id)
  where kind = 'friend_request';

create or replace function public.notify_of_friendship()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  asked  uuid;        -- who is being told
  actor  uuid;        -- who caused it
  which  text;
begin
  if tg_op = 'INSERT' then
    -- The one who did not ask is the one who hears about it.
    asked := case when new.asked_by = new.low_id then new.high_id else new.low_id end;
    actor := new.asked_by;
    which := 'friend_request';
  else
    if old.state = new.state then return new; end if;
    if new.state <> 'accepted' then return new; end if;

    -- Now it is the asker's turn to be told, by the one who said yes.
    asked := new.asked_by;
    actor := case when new.asked_by = new.low_id then new.high_id else new.low_id end;
    which := 'friend_accepted';
  end if;

  if not exists (select 1 from public.profiles p
                  where p.id = asked and p.notify_friend) then
    return new;
  end if;

  insert into public.notifications (user_id, kind, actor_id)
  values (asked, which, actor)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists notify_of_friendship on public.friendships;
create trigger notify_of_friendship
  after insert or update of state on public.friendships
  for each row execute function public.notify_of_friendship();

-- ---------------------------------------------------------------------------
-- 7. Keep the machinery off the public API.
--
-- Supabase publishes everything in the public schema as a web address.
-- ask_to_be_friends is meant to be called; the rest are not.
-- ---------------------------------------------------------------------------
revoke all on function public.guard_friendship()     from public, anon, authenticated;
revoke all on function public.notify_of_friendship() from public, anon, authenticated;

revoke all on function public.friends_with(uuid)       from public, anon;
revoke all on function public.ask_to_be_friends(text)  from public, anon;
grant execute on function public.friends_with(uuid)      to authenticated;
grant execute on function public.ask_to_be_friends(text) to authenticated;
