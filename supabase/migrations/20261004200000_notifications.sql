-- MyMon — notifications: the bell in the corner.
--
-- What a notification is, and who is allowed to make one
-- ------------------------------------------------------
-- A row here says "something happened that concerns you". The one rule that
-- matters: **a browser can never write one**. There is no insert policy on
-- this table for anybody. Rows appear only from the triggers below, which run
-- as the definer and are not callable over the API.
--
-- That is not tidiness. If a signed-in person could insert a notification for
-- any user_id, the bell would be an open channel for sending strangers
-- whatever text you liked — and the notification is rendered in their browser.
-- Taking the pen away from the client closes it by construction.
--
-- Who gets told what
-- ------------------
--   group_invite      the person invited, when the owner invites them
--   group_comment     every *member* of the group, when somebody comments
--   comment_on_mine   the same, but it was a comment on your own entry
--
-- Members, not invitees. Somebody who has only been invited can see the
-- group's name and nothing else, so "Ana commented on Rent, October" would
-- hand them exactly what the rules withhold. They get the invitation and
-- nothing more until they join.
--
-- Nobody is ever told about their own doing: the author of a comment does not
-- get a notification for it.

-- ---------------------------------------------------------------------------
-- 1. What each person wants to hear about.
--
-- These live beside the name on the profile because they are settings, not
-- secrets, and the triggers below have to read them. Default on: somebody who
-- has just been added to a group wants to know it happened.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists notify_group_invite    boolean not null default true,
  add column if not exists notify_group_comment   boolean not null default true,
  add column if not exists notify_comment_on_mine boolean not null default true;

-- ---------------------------------------------------------------------------
-- 2. The table.
--
-- Every reference is `on delete cascade` on purpose. A notification about a
-- comment that has been deleted, or a group that is gone, is a dead end with a
-- name in it — better that it disappears with the thing it was about.
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid        primary key default gen_random_uuid(),

  -- who is being told
  user_id    uuid        not null references auth.users (id) on delete cascade,

  kind       text        not null
                         check (kind in ('group_invite', 'group_comment', 'comment_on_mine')),

  -- who caused it. Null once that account is gone; the notification survives.
  actor_id   uuid        references auth.users (id) on delete set null,

  group_id   uuid        references public.groups (id)         on delete cascade,
  entry_id   uuid        references public.group_expenses (id) on delete cascade,
  comment_id uuid        references public.group_comments (id) on delete cascade,

  created_at timestamptz not null default now(),

  -- null while unread. A timestamp rather than a boolean because "when did I
  -- see this" is free to keep and impossible to add afterwards.
  read_at    timestamptz
);

-- The bell asks one question on every page load: what is mine, newest first.
create index if not exists notifications_mine_idx
  on public.notifications (user_id, created_at desc);

-- And one more: how many unread. Partial, because the read ones are most of
-- them after a week and none of them belong in this index.
create index if not exists notifications_unread_idx
  on public.notifications (user_id)
  where read_at is null;

-- Being invited twice to the same group should not ring twice.
create unique index if not exists notifications_one_invite_idx
  on public.notifications (user_id, group_id)
  where kind = 'group_invite';

alter table public.notifications enable row level security;

-- ---------------------------------------------------------------------------
-- 3. The rules.
--
-- Read your own. Mark your own as read. Throw your own away. There is
-- deliberately no insert policy: see the top of this file.
-- ---------------------------------------------------------------------------
drop policy if exists "read my notifications"    on public.notifications;
drop policy if exists "mark my notifications"    on public.notifications;
drop policy if exists "dismiss my notifications" on public.notifications;

create policy "read my notifications" on public.notifications
  for select using (auth.uid() = user_id);

create policy "mark my notifications" on public.notifications
  for update using (auth.uid() = user_id)
             with check (auth.uid() = user_id);

create policy "dismiss my notifications" on public.notifications
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. An update may only ever mark something read.
--
-- The policy above lets you update your own row, and a policy cannot see what
-- the row looked like before. Without this, "mark as read" would also be
-- "rewrite the notification I was sent" — change its kind, point it at another
-- group, forge who it came from. A trigger can see OLD, so it does the part
-- RLS cannot.
-- ---------------------------------------------------------------------------
create or replace function public.guard_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.id         is distinct from old.id
  or new.user_id    is distinct from old.user_id
  or new.kind       is distinct from old.kind
  or new.actor_id   is distinct from old.actor_id
  or new.group_id   is distinct from old.group_id
  or new.entry_id   is distinct from old.entry_id
  or new.comment_id is distinct from old.comment_id
  or new.created_at is distinct from old.created_at then
    raise exception 'a notification can only be marked read';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_notification on public.notifications;
create trigger guard_notification
  before update on public.notifications
  for each row execute function public.guard_notification();

-- ---------------------------------------------------------------------------
-- 5. Being invited to a group.
--
-- Fires both ways in: a fresh row at 'invited', and a row walked back from
-- 'left' to 'invited' when an owner asks somebody to return.
-- ---------------------------------------------------------------------------
create or replace function public.notify_of_invite()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state <> 'invited' then return new; end if;
  if tg_op = 'UPDATE' and old.state = 'invited' then return new; end if;

  if not exists (select 1 from public.profiles p
                  where p.id = new.user_id and p.notify_group_invite) then
    return new;
  end if;

  insert into public.notifications (user_id, kind, actor_id, group_id)
  values (new.user_id, 'group_invite', new.invited_by, new.group_id)
  -- Asked back after leaving, with the first invitation still in the bell.
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists notify_of_invite on public.group_members;
create trigger notify_of_invite
  after insert or update of state on public.group_members
  for each row execute function public.notify_of_invite();

-- ---------------------------------------------------------------------------
-- 6. Somebody commented.
--
-- Everybody in the group hears about it except the person who wrote it. The
-- one whose entry was commented on gets the louder kind, so the bell can say
-- "on your expense" rather than "in Flat 14".
-- ---------------------------------------------------------------------------
create or replace function public.notify_of_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  gid   uuid;
  owner uuid;
begin
  select e.group_id, e.user_id into gid, owner
    from public.group_expenses e
   where e.id = new.group_expense_id;

  if gid is null then return new; end if;

  insert into public.notifications (user_id, kind, actor_id, group_id, entry_id, comment_id)
  select m.user_id,
         case when m.user_id = owner then 'comment_on_mine' else 'group_comment' end,
         new.author_id, gid, new.group_expense_id, new.id
    from public.group_members m
    join public.profiles p on p.id = m.user_id
   where m.group_id = gid
     and m.state = 'member'
     and m.user_id <> new.author_id          -- not your own doing
     and case when m.user_id = owner then p.notify_comment_on_mine
                                     else p.notify_group_comment end;

  return new;
end;
$$;

drop trigger if exists notify_of_comment on public.group_comments;
create trigger notify_of_comment
  after insert on public.group_comments
  for each row execute function public.notify_of_comment();

-- ---------------------------------------------------------------------------
-- 7. Keep the trigger functions off the public API.
--
-- Supabase publishes everything in the public schema as a web address. These
-- three are meant to be reached only by the triggers that own them.
-- ---------------------------------------------------------------------------
revoke all on function public.guard_notification()  from public, anon, authenticated;
revoke all on function public.notify_of_invite()    from public, anon, authenticated;
revoke all on function public.notify_of_comment()   from public, anon, authenticated;
