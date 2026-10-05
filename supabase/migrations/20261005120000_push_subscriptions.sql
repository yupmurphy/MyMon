-- MyMon — push subscriptions: the part that makes a phone ring.
--
-- What a subscription is
-- ----------------------
-- When a browser is given permission to show notifications, it hands the page
-- three strings: an **endpoint** — a one-off web address belonging to Google,
-- Apple or Mozilla, which forwards anything posted to it on to that one
-- browser on that one device — and two keys used to encrypt the message so the
-- forwarder cannot read it.
--
-- So a row here is not a preference. It is a **capability**: whoever holds the
-- endpoint and the keys can make that device buzz. That single fact decides
-- everything below.
--
-- Why there is no insert policy
-- -----------------------------
-- The same reason as `public.notifications`: the browser does not get the pen.
-- But here the reason is sharper, because a device changes hands. You sign out
-- on a phone, somebody else signs in — the endpoint is still the same endpoint.
-- If the browser could insert freely, the old row would survive and every
-- notification meant for you would arrive on a screen that is no longer yours.
--
-- So writing goes through `remember_push`, which first deletes any claim on
-- that endpoint and only then records the new one. Whoever is signed in now
-- owns the device. Not negotiable, and not something a forgotten sign-out can
-- get wrong.
--
-- Why there is no "ring my phone" switch
-- --------------------------------------
-- The four switches on the profile say *what* you want to hear about. They are
-- not repeated here, because the presence of a row **is** the switch: no row,
-- no push, and turning it off is deleting the row. One truth, one place. A
-- second boolean would only create the state where the switch says yes and the
-- browser has revoked permission anyway.

-- ---------------------------------------------------------------------------
-- 1. The table.
--
-- The endpoint is the primary key, not an id of our own. It is already unique
-- per browser per device, and making it the key means a browser that
-- re-subscribes replaces its row instead of quietly collecting a second one —
-- which is how people end up getting every notification twice.
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  endpoint   text        primary key,

  user_id    uuid        not null references auth.users (id) on delete cascade,

  -- The two encryption keys the browser handed over. Named with a prefix
  -- because a bare `auth` column beside the `auth` schema reads as a mistake
  -- every time somebody comes back to this file.
  key_p256dh text        not null,
  key_auth   text        not null,

  -- Something human, so the list in Settings says "Chrome on Android" rather
  -- than 230 characters of address. Written by the browser, so it is a label,
  -- not evidence — nothing is ever decided from it.
  label      text,

  created_at timestamptz not null default now()
);

-- The only question anybody asks of this table: what do I have to send to, for
-- this one person.
create index if not exists push_subscriptions_mine_idx
  on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- 2. Who may see and remove one.
--
-- Select and delete, yours only. No insert, no update — see the header.
-- Reading somebody else's row would hand over the capability itself, which is
-- why this is `auth.uid() = user_id` and not anything cleverer.
-- ---------------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;

drop policy if exists "see my own devices"    on public.push_subscriptions;
drop policy if exists "forget my own devices" on public.push_subscriptions;

create policy "see my own devices"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

create policy "forget my own devices"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. Recording a device.
--
-- Returns a word, like the friends function does, so the browser can say
-- something useful without the caller having to read a Postgres error.
--
--   not_signed_in   nobody is signed in
--   bad_endpoint    the browser handed over something that is not an endpoint
--   remembered      done
-- ---------------------------------------------------------------------------
create or replace function public.remember_push(
  sub_endpoint text,
  sub_p256dh   text,
  sub_auth     text,
  sub_label    text default null
)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return 'not_signed_in';
  end if;

  -- Push endpoints are https addresses handed out by the browser vendor. This
  -- is not validation of who owns it — it cannot be — it only refuses the
  -- obviously empty and the obviously wrong, so the table does not fill with
  -- rows that could never receive anything.
  if sub_endpoint is null
     or sub_endpoint !~ '^https://[a-z0-9.-]+/'
     or length(sub_endpoint) > 2000
     or sub_p256dh is null or length(sub_p256dh) not between 20 and 200
     or sub_auth   is null or length(sub_auth)   not between 10 and 100
  then
    return 'bad_endpoint';
  end if;

  -- The device changed hands, or this is simply the same browser asking again.
  -- Either way the old claim goes first. This is the whole reason the browser
  -- is not allowed to insert directly.
  delete from public.push_subscriptions p where p.endpoint = sub_endpoint;

  insert into public.push_subscriptions (endpoint, user_id, key_p256dh, key_auth, label)
  values (sub_endpoint, auth.uid(), sub_p256dh, sub_auth, left(sub_label, 80));

  return 'remembered';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Which notifications have been sent to a phone already.
--
-- Null means "nobody has pushed this yet". The sender claims rows, posts them,
-- and stamps them. Kept on the notification rather than in a queue of its own
-- because the notification *is* the queue — it already knows who it is for and
-- what it says, and a second table would be two things to keep in step.
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists pushed_at timestamptz;

create index if not exists notifications_unpushed_idx
  on public.notifications (created_at)
  where pushed_at is null;

-- ---------------------------------------------------------------------------
-- 5. Permissions.
--
-- Same shape as everywhere else in this project: the trigger-ish internals are
-- taken away from everybody, and the one function a signed-in browser is meant
-- to call is granted to `authenticated` and nobody else. `anon` has no
-- business here — there is no device to remember before there is an account.
-- ---------------------------------------------------------------------------
revoke all on function public.remember_push(text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.remember_push(text, text, text, text)
  to authenticated;
