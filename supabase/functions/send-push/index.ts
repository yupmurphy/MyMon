// MyMon — the half of a notification that runs on a server.
//
// Everything else about notifications happens in a browser. This cannot: by
// the time somebody's phone should buzz, MyMon is closed and there is no page
// of ours anywhere to do it. So this runs on Supabase, on a timer, and does
// three things:
//
//   1. claims a batch of notifications nobody has pushed yet
//   2. looks up the devices belonging to the people they are for
//   3. posts each one to the push service that forwards to that device
//
// What it needs, and where from
// -----------------------------
// Three secrets, set with `supabase secrets set` (or in the dashboard, under
// Edge Functions → Secrets):
//
//   VAPID_PUBLIC_KEY    the same string that is in js/config.js
//   VAPID_PRIVATE_KEY   the real secret. It belongs here and nowhere else —
//                       never in the repository, never in the browser
//   VAPID_SUBJECT       a mailto: address. The push services want somebody to
//                       contact if this starts misbehaving
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase itself;
// they are not set by hand. The service role is used on purpose: this has to
// read every person's devices, which is exactly what the row rules forbid to
// everybody else.
//
// Why a timer and not a trigger
// -----------------------------
// A trigger firing on each new notification would send sooner, but it would
// also make every comment in a group wait for several HTTP requests before it
// is saved. A minute of delay on a buzz costs nothing; a comment that takes
// two seconds to post costs every time.

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// A notification nobody sent in time is not worth sending at all. If this
// function has been failing for a day, the repair must not be everybody's
// phone buzzing forty times at once — the bell inside MyMon still has all of
// them, in order, which is the right place to catch up.
const TOO_OLD_MS = 6 * 60 * 60 * 1000;

const BATCH = 50;

type Claimed = {
  notification_id: string;
  user_id: string;
  kind: string;
  group_id: string | null;
  entry_id: string | null;
  created_at: string;
  actor_name: string;
  group_name: string;
};

// The same sentences as the bell in js/notifications.js, without the markup.
// One difference, and it is deliberate: the bell can name the expense because
// the browser holds the list of categories, and this cannot. "your expense in
// Rent" is less specific than "your Groceries" but it is never wrong.
function sentence(row: Claimed): string {
  const who = row.actor_name;
  const group = row.group_name;

  switch (row.kind) {
    case 'friend_request': return `${who} wants to be friends`;
    case 'friend_accepted': return `${who} and you are friends now`;
    case 'group_invite': return `${who} invited you to ${group}`;
    case 'comment_on_mine': return `${who} commented on your expense in ${group}`;
    default: return `${who} commented in ${group}`;
  }
}

// Where tapping it goes. Mirrors destination() in js/notifications.js.
function destination(row: Claimed): string {
  if (row.kind === 'friend_request' || row.kind === 'friend_accepted') {
    return 'dashboard.html#friends';
  }

  let hash = '#groups';
  if (row.group_id) hash += '/' + row.group_id;
  if (row.entry_id) hash += '/' + row.entry_id;
  return 'dashboard.html' + hash;
}

// Notifications about the same group collapse into one line on the lock
// screen rather than stacking. A busy evening in one group should be one
// notification you open, not eleven you dismiss.
function tagFor(row: Claimed): string {
  if (row.kind.startsWith('friend_')) return 'mymon-friends';
  return row.group_id ? 'mymon-group-' + row.group_id : 'mymon';
}

Deno.serve(async () => {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');

  if (!publicKey || !privateKey || !subject) {
    // Said plainly, because the one time anybody reads this is while setting
    // the secrets for the first time.
    return new Response(
      JSON.stringify({ error: 'Missing VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY or VAPID_SUBJECT.' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Claiming and reading are one step on purpose — see the comment at the top
  // of supabase/migrations/20261005140000_claim_push_batch.sql.
  const { data: claimed, error: claimError } =
    await db.rpc('claim_push_batch', { how_many: BATCH });

  if (claimError) {
    return new Response(JSON.stringify({ error: claimError.message }),
      { status: 500, headers: { 'content-type': 'application/json' } });
  }

  const rows = (claimed ?? []) as Claimed[];
  if (!rows.length) {
    return new Response(JSON.stringify({ claimed: 0, sent: 0 }),
      { headers: { 'content-type': 'application/json' } });
  }

  const fresh = rows.filter(
    (row) => Date.now() - new Date(row.created_at).getTime() < TOO_OLD_MS
  );

  // One query for every device belonging to anybody in this batch, rather than
  // one per notification. Fifty notifications about the same group would
  // otherwise be fifty identical lookups.
  const people = [...new Set(fresh.map((row) => row.user_id))];

  const { data: devices, error: deviceError } = people.length
    ? await db.from('push_subscriptions')
        .select('endpoint, user_id, key_p256dh, key_auth')
        .in('user_id', people)
    : { data: [], error: null };

  if (deviceError) {
    return new Response(JSON.stringify({ error: deviceError.message }),
      { status: 500, headers: { 'content-type': 'application/json' } });
  }

  const byPerson = new Map<string, typeof devices>();
  for (const device of devices ?? []) {
    const list = byPerson.get(device.user_id) ?? [];
    list.push(device);
    byPerson.set(device.user_id, list);
  }

  let sent = 0;
  const dead: string[] = [];

  await Promise.all(fresh.flatMap((row) =>
    (byPerson.get(row.user_id) ?? []).map(async (device) => {
      const payload = JSON.stringify({
        title: sentence(row),
        url: destination(row),
        tag: tagFor(row)
      });

      try {
        await webpush.sendNotification({
          endpoint: device.endpoint,
          keys: { p256dh: device.key_p256dh, auth: device.key_auth }
        }, payload);
        sent++;
      } catch (error) {
        // 404 and 410 are the push service saying this device is gone for
        // good — the app was uninstalled, or permission was withdrawn. Keeping
        // the row would mean failing on it forever. Anything else is a
        // temporary fault and the row stays.
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(device.endpoint);
      }
    })
  ));

  if (dead.length) {
    await db.from('push_subscriptions').delete().in('endpoint', dead);
  }

  return new Response(
    JSON.stringify({ claimed: rows.length, stale: rows.length - fresh.length, sent, forgotten: dead.length }),
    { headers: { 'content-type': 'application/json' } }
  );
});
