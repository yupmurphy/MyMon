-- MyMon — groups: a shared ledger a few people write into, and comments on it.
--
-- What a group is, and what it is not
-- -----------------------------------
-- A group has its own expenses. They are *not* your personal expenses seen
-- from a second angle — they are separate rows, written on purpose:
--
--   * typed straight into the group, for something that has no business in
--     your private list at all; or
--   * copied from a personal expense, which leaves the original exactly where
--     it was and puts a duplicate in the group.
--
-- A copy, not a link. That costs a little space and buys three things:
--
--   1. Nothing of yours is ever shared by accident. Your personal list stays
--      shut, with the same one-line rule it has had since the first migration —
--      this file does not widen it by a single character. The only way anything
--      reaches a group is you pressing a button that says so.
--   2. Tidying up your own list never reaches into a group. Fix a typo, delete
--      a row, change your mind — a total somebody else is looking at does not
--      move underneath them.
--   3. What a group is for is up to the group: splitting a holiday, or just
--      watching what your friends spend. Either way the choice of where an
--      expense goes is a decision you make every time, never a default that
--      happens to you.
--
-- Three decisions this file is built on, recorded so the reasoning survives:
--
--   1. You join a group by username, and only after you accept. Nobody is put
--      into a group on someone else's say-so, and there is no invitation link
--      that can be forwarded, screenshotted, or left in a chat a stranger
--      reads.
--
--   2. Leaving a group does not take your entries out of it. A shared total
--      that shrinks by itself when somebody leaves is worse than one you
--      cannot erase — a group is often an event, and the event cost what it
--      cost. Whoever leaves stops seeing the group. Nothing of theirs is lost:
--      what they put in the group was always a copy, and the originals are
--      still sitting in their own private list.
--
--   3. Only the person who wrote a row may change or delete it. Nobody edits
--      anyone else's entry, ever. Removing people, and deleting the group
--      itself, belong to whoever made the group.
--
-- Creates only what is missing, so running it again changes nothing.


-- ===========================================================================
-- 1. The group
-- ===========================================================================

create table if not exists public.groups (
  id         uuid        primary key default gen_random_uuid(),

  name       text        not null
                         check (char_length(btrim(name)) between 1 and 40),

  -- Whoever made it. Filled in from whoever is signed in, so the browser
  -- cannot create a group in somebody else's name.
  owner_id   uuid        not null default auth.uid()
                         references auth.users (id) on delete cascade,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- ===========================================================================
-- 2. Who is in it
--
-- Three states, and a row never leaves this table:
--
--   invited  someone was asked and has not answered yet
--   member   they accepted; they can see the group
--   left     they walked out, or the owner removed them
--
-- The 'left' row is the whole reason this table does not simply delete rows.
-- Decision 2 keeps their entries in the group, so the others still see
-- "Ana — 400 lei" — and to print the name "Ana" at all, they have to be
-- allowed to read her profile. That permission is granted in section 8 by
-- "we share a group", and this row is what keeps that sentence true after she
-- leaves. Delete the row and her name goes dark.
-- ===========================================================================

create table if not exists public.group_members (
  group_id   uuid        not null references public.groups (id) on delete cascade,
  user_id    uuid        not null references auth.users (id)    on delete cascade,

  state      text        not null default 'invited'
                         check (state in ('invited', 'member', 'left')),

  invited_by uuid        references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),

  -- Stamped by the trigger in section 6, never by the browser.
  joined_at  timestamptz,
  left_at    timestamptz,

  primary key (group_id, user_id)
);

-- "Which groups am I in" is the first question every page asks.
create index if not exists group_members_user_idx
  on public.group_members (user_id, state);


-- ===========================================================================
-- 3. The group's own expenses
--
-- Deliberately a table of its own rather than a flag on public.transactions.
-- The two ledgers answer different questions and are allowed to disagree: one
-- is what you spent, the other is what the group knows about. The columns
-- mirror the personal ones, with the same limits, because a group entry is the
-- same kind of fact — just written somewhere else.
--
-- `copied_from` remembers which personal expense a copy came from, so the app
-- can mark it as already copied instead of letting you put it in twice. It is
-- only ever a reference: other members can read the column, and it tells them
-- nothing, because nobody's personal rows are readable by anybody else. If the
-- original is later deleted the copy stays and simply forgets where it came
-- from.
-- ===========================================================================

create table if not exists public.group_expenses (
  id          uuid        primary key default gen_random_uuid(),

  group_id    uuid        not null references public.groups (id) on delete cascade,

  -- Who put it in. Filled in from whoever is signed in.
  user_id     uuid        not null default auth.uid()
                          references auth.users (id) on delete cascade,

  amount      numeric(10, 2) not null
                          check (amount >= 0.01 and amount <= 999999.99),

  currency    text        not null
                          check (currency ~ '^[A-Z]{3}$'),

  category    text        not null
                          check (category in ('food', 'bills', 'transport',
                                              'entertainment', 'hobby',
                                              'other', 'shopping')),

  spent_on    date        not null,

  comment     text        not null default ''
                          check (char_length(comment) <= 140),

  copied_from uuid        references public.transactions (id) on delete set null,

  created_at  timestamptz not null default now()
);

-- Reading one group, newest first — the only query the group page makes.
create index if not exists group_expenses_group_date_idx
  on public.group_expenses (group_id, spent_on desc);

-- The same personal expense cannot land in the same group twice, so a double
-- tap on "copy" is harmless. Nulls do not collide, so anything typed straight
-- into the group is unaffected, and the same expense may go to two different
-- groups.
create unique index if not exists group_expenses_copy_once_idx
  on public.group_expenses (group_id, copied_from)
  where copied_from is not null;


-- ===========================================================================
-- 4. Comments
--
-- On group entries only. A comment is something you say to somebody, and
-- there is nobody to say it to on a private row.
-- ===========================================================================

create table if not exists public.group_comments (
  id               uuid        primary key default gen_random_uuid(),

  group_expense_id uuid        not null
                               references public.group_expenses (id) on delete cascade,

  author_id        uuid        not null default auth.uid()
                               references auth.users (id) on delete cascade,

  body             text        not null
                               check (char_length(btrim(body)) between 1 and 280),

  created_at       timestamptz not null default now()
);

create index if not exists group_comments_expense_idx
  on public.group_comments (group_expense_id, created_at);


-- ===========================================================================
-- 5. The questions the rules need to ask
--
-- A rule on group_members that asked "am I a member of this group?" would read
-- group_members to find out — and reading it would run the rule again, for
-- ever. These functions are the way out: they are allowed to look at the whole
-- table (security definer), so the rules do not have to, and each one answers
-- nothing but yes or no. They give away no names and no lists.
--
-- `set search_path = ''`, with everything spelled out in full, says exactly
-- which lower() and which now() is meant, so nothing placed earlier on the
-- lookup path can answer in their place.
-- ===========================================================================

-- Am I in this group right now, with access to it?
create or replace function public.is_group_member(gid uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.group_members m
     where m.group_id = gid and m.user_id = auth.uid() and m.state = 'member'
  );
$$;

-- Do I have any business seeing this group's name? Members, and also anyone
-- holding an unanswered invitation — you cannot decide whether to accept an
-- invitation to a group whose name you are not allowed to read.
create or replace function public.sees_group(gid uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.group_members m
     where m.group_id = gid and m.user_id = auth.uid()
       and m.state in ('invited', 'member')
  );
$$;

create or replace function public.owns_group(gid uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.groups g where g.id = gid and g.owner_id = auth.uid()
  );
$$;

-- Is this person in a group with me? This is what lets members see each
-- other's names. Mine has to be a live membership; theirs may be a 'left'
-- one, which is how a name stays printable after its owner walks out.
create or replace function public.shares_a_group(other uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1
      from public.group_members mine
      join public.group_members theirs on theirs.group_id = mine.group_id
     where mine.user_id = auth.uid() and mine.state = 'member'
       and theirs.user_id = other and theirs.state in ('member', 'left')
  );
$$;

-- May I see the entry this comment hangs on?
create or replace function public.can_see_group_expense(eid uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.group_expenses e
     where e.id = eid and public.is_group_member(e.group_id)
  );
$$;

revoke all on function public.is_group_member(uuid)       from public, anon;
revoke all on function public.sees_group(uuid)            from public, anon;
revoke all on function public.owns_group(uuid)            from public, anon;
revoke all on function public.shares_a_group(uuid)        from public, anon;
revoke all on function public.can_see_group_expense(uuid) from public, anon;

grant execute on function public.is_group_member(uuid)       to authenticated;
grant execute on function public.sees_group(uuid)            to authenticated;
grant execute on function public.owns_group(uuid)            to authenticated;
grant execute on function public.shares_a_group(uuid)        to authenticated;
grant execute on function public.can_see_group_expense(uuid) to authenticated;


-- ===========================================================================
-- 6. The moves a membership is allowed to make
--
-- Without this, the update rule in section 8 has a hole big enough to walk
-- back through. A rule can only say "this row is yours to change", and the row
-- that says 'left' is still yours — so the person the owner has just removed
-- could set it back to 'member' and let themselves in again. A rule cannot see
-- what the row said a moment ago. A trigger can, so the states are policed
-- here, and the timestamps are stamped here too rather than being taken on
-- trust from the browser.
-- ===========================================================================

create or replace function public.guard_group_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  owner uuid;
begin
  select g.owner_id into owner from public.groups g where g.id = new.group_id;

  if tg_op = 'INSERT' then
    -- The only person who is a member the instant the row appears is whoever
    -- made the group; everybody else has to be invited and has to accept.
    if new.state = 'member' and new.user_id is distinct from owner then
      raise exception 'A member joins by accepting an invitation, not by being added.';
    end if;
    if new.state = 'left' then
      raise exception 'Nobody starts out having already left.';
    end if;
    if new.state = 'member' then new.joined_at = pg_catalog.now(); end if;
    return new;
  end if;

  if new.group_id <> old.group_id or new.user_id <> old.user_id then
    raise exception 'A membership cannot be moved to another group or another person.';
  end if;

  -- The owner is not allowed out, by themselves or by anyone else: a group
  -- with nobody in charge can never be tidied up again. Hand it over first,
  -- or delete the group.
  if old.user_id = owner and new.state <> old.state then
    raise exception 'The owner cannot leave or be removed. Hand the group over, or delete it.';
  end if;

  if not (
       (old.state = 'invited' and new.state in ('member', 'left'))
    or (old.state = 'member'  and new.state = 'left')
    or (old.state = 'left'    and new.state = 'invited' and auth.uid() = owner)
    or (old.state = new.state)
  ) then
    raise exception 'A membership goes invited -> member -> left, and no other way.';
  end if;

  -- Accepting is something only the person invited can do.
  if old.state = 'invited' and new.state = 'member' and auth.uid() <> old.user_id then
    raise exception 'Only the person invited can accept an invitation.';
  end if;

  if new.state = 'member' and old.state <> 'member' then new.joined_at = pg_catalog.now(); end if;
  if new.state = 'left'   and old.state <> 'left'   then new.left_at   = pg_catalog.now(); end if;

  return new;
end;
$$;

drop trigger if exists group_members_guard on public.group_members;

create trigger group_members_guard
  before insert or update on public.group_members
  for each row execute function public.guard_group_membership();


-- Whoever makes a group is in it, without the browser having to remember to
-- say so in a second write that could fail on its own.
create or replace function public.join_own_group()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.group_members (group_id, user_id, state, invited_by)
  values (new.id, new.owner_id, 'member', new.owner_id)
  on conflict (group_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists groups_owner_joins on public.groups;

create trigger groups_owner_joins
  after insert on public.groups
  for each row execute function public.join_own_group();


drop trigger if exists groups_touch_updated_at on public.groups;

create trigger groups_touch_updated_at
  before update on public.groups
  for each row execute function public.touch_updated_at();


-- ===========================================================================
-- 7. An entry cannot be moved to another group, or onto another person
--
-- The rules in section 8 say a row is yours to edit. They cannot say that the
-- group it sits in has to stay the same, because a rule never sees what the
-- row said before. Without this, your own entry could be edited into a group
-- you are not even in.
-- ===========================================================================

create or replace function public.guard_group_expense()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.group_id <> old.group_id then
      raise exception 'An entry stays in the group it was written in.';
    end if;
    if new.user_id <> old.user_id then
      raise exception 'An entry stays with the person who wrote it.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists group_expenses_guard on public.group_expenses;

create trigger group_expenses_guard
  before update on public.group_expenses
  for each row execute function public.guard_group_expense();


-- ===========================================================================
-- 8. The rules themselves
--
-- Note what is *not* here: public.transactions is not touched. Your personal
-- list keeps the rule it was born with — "you see your own rows" — and this
-- whole feature adds nothing to it. That is the main thing copying buys.
-- ===========================================================================

alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.group_expenses enable row level security;
alter table public.group_comments enable row level security;

-- --- the group ------------------------------------------------------------
drop policy if exists "see groups I am in"  on public.groups;
drop policy if exists "make a group"        on public.groups;
drop policy if exists "owner renames group" on public.groups;
drop policy if exists "owner deletes group" on public.groups;

create policy "see groups I am in" on public.groups
  for select using (owner_id = auth.uid() or public.sees_group(id));

create policy "make a group" on public.groups
  for insert with check (owner_id = auth.uid());

create policy "owner renames group" on public.groups
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner deletes group" on public.groups
  for delete using (owner_id = auth.uid());

-- --- who is in it ---------------------------------------------------------
drop policy if exists "see the people in my groups" on public.group_members;
drop policy if exists "owner invites"               on public.group_members;
drop policy if exists "accept, leave, or remove"    on public.group_members;

-- Members see each other, including the rows of people who have left. Someone
-- holding an invitation sees the group and its people before deciding.
create policy "see the people in my groups" on public.group_members
  for select using (user_id = auth.uid() or public.sees_group(group_id));

-- Rows only ever appear through the owner: either invite_to_group() in section
-- 9, or the trigger that puts the owner into their own new group.
create policy "owner invites" on public.group_members
  for insert with check (public.owns_group(group_id));

-- Who may touch a row at all. *Which* change is allowed is section 6's job.
create policy "accept, leave, or remove" on public.group_members
  for update using (user_id = auth.uid() or public.owns_group(group_id))
             with check (user_id = auth.uid() or public.owns_group(group_id));

-- No delete rule, on purpose. Nothing may delete a membership row: walking out
-- sets it to 'left'. Dropping the group drops its rows along with it.

-- --- the group's expenses -------------------------------------------------
drop policy if exists "read the group's expenses" on public.group_expenses;
drop policy if exists "add to a group I am in"     on public.group_expenses;
drop policy if exists "edit my own entries"        on public.group_expenses;
drop policy if exists "delete my own entries"      on public.group_expenses;

-- Everyone in the group reads the whole ledger — that is what the group is.
-- Membership, not authorship: and when you leave, this is the sentence that
-- stops being true about you. Your entries stay; your view of them ends.
create policy "read the group's expenses" on public.group_expenses
  for select using (public.is_group_member(group_id));

create policy "add to a group I am in" on public.group_expenses
  for insert with check (user_id = auth.uid() and public.is_group_member(group_id));

-- Yours to correct and yours to take back, for as long as you are in the
-- group. Nobody else's — not even the owner's to touch.
create policy "edit my own entries" on public.group_expenses
  for update using (user_id = auth.uid() and public.is_group_member(group_id))
             with check (user_id = auth.uid());

create policy "delete my own entries" on public.group_expenses
  for delete using (user_id = auth.uid() and public.is_group_member(group_id));

-- --- profiles -------------------------------------------------------------
-- A name has to be readable for a shared entry to be able to say whose it is.
-- This is the only thing it opens: the username of somebody in a group with
-- you. Your own profile stays covered by the rule that was already there.
drop policy if exists "read profiles in my groups" on public.profiles;

create policy "read profiles in my groups" on public.profiles
  for select using (public.shares_a_group(id));

-- --- comments -------------------------------------------------------------
drop policy if exists "read comments in my groups" on public.group_comments;
drop policy if exists "write my own comments"      on public.group_comments;
drop policy if exists "edit my own comments"       on public.group_comments;
drop policy if exists "delete my own comments"     on public.group_comments;

create policy "read comments in my groups" on public.group_comments
  for select using (public.can_see_group_expense(group_expense_id));

create policy "write my own comments" on public.group_comments
  for insert with check (author_id = auth.uid()
                         and public.can_see_group_expense(group_expense_id));

-- Yours to fix and yours to take back. Nobody else's — not the person whose
-- entry is being commented on, and not whoever made the group. At the size of
-- a few friends you do not need a moderator, and nothing can be quietly made
-- to disappear.
create policy "edit my own comments" on public.group_comments
  for update using (author_id = auth.uid()) with check (author_id = auth.uid());

create policy "delete my own comments" on public.group_comments
  for delete using (author_id = auth.uid());


-- ===========================================================================
-- 9. Inviting, without handing out ids
--
-- The owner types a username. They are not allowed to read anybody's profile
-- except their own and their groupmates', so they cannot turn a new name into
-- the id this table needs — and they should not be able to. This function does
-- the whole thing behind the counter and answers with a single word, so the id
-- of a stranger's account never reaches a browser.
--
-- It does reveal whether a username is taken. That much is already public by
-- design: username_available() answers the same question so the sign-up form
-- can tell you the name is gone.
-- ===========================================================================

create or replace function public.invite_to_group(gid uuid, candidate text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  owner    uuid;
  target   uuid;
  standing text;
begin
  select g.owner_id into owner from public.groups g where g.id = gid;
  if owner is null       then return 'no_such_group'; end if;
  if owner <> auth.uid() then return 'not_owner';     end if;

  select p.id into target from public.profiles p
   where p.username = pg_catalog.lower(pg_catalog.btrim(candidate));
  if target is null      then return 'no_such_user';  end if;
  if target = auth.uid() then return 'self';          end if;

  select m.state into standing from public.group_members m
   where m.group_id = gid and m.user_id = target;

  if standing = 'member'  then return 'already_in';      end if;
  if standing = 'invited' then return 'already_invited'; end if;

  if standing = 'left' then
    -- Asking somebody back. Only the owner can walk a row back to 'invited',
    -- and they still have to accept again.
    update public.group_members
       set state = 'invited', invited_by = auth.uid(), invited_at = pg_catalog.now()
     where group_id = gid and user_id = target;
  else
    insert into public.group_members (group_id, user_id, state, invited_by)
    values (gid, target, 'invited', auth.uid());
  end if;

  return 'invited';
end;
$$;

revoke all on function public.invite_to_group(uuid, text) from public, anon;
grant execute on function public.invite_to_group(uuid, text) to authenticated;


-- ===========================================================================
-- 10. Checks worth running afterwards, from two different accounts
--
--   -- as A, who shares one group with B and is in no other:
--   select count(*) from public.transactions;    -- A's own, and not one more
--   select count(*) from public.group_expenses;  -- exactly that group's
--   select username from public.profiles;        -- A and B, nobody else
--
--   -- as C, who is in no group with anybody:
--   select count(*) from public.group_expenses;  -- 0
--   select username from public.profiles;        -- only C
--
--   -- the hole section 6 closes, tried as a removed member:
--   update public.group_members set state = 'member'
--    where user_id = auth.uid();                 -- must raise, not pass
--
--   -- and the one section 7 closes, tried on your own entry:
--   update public.group_expenses set group_id = '<another group>'
--    where user_id = auth.uid();                 -- must raise, not pass
-- ===========================================================================
