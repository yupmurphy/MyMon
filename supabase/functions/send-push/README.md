# Turning on notifications on a phone

Everything in the browser is built and in place. What is left is three things
that only the owner of the project can do, because two of them involve a
secret and one of them costs money the day it ever does.

Nothing here has to be done in one sitting. Until step 2 is finished, MyMon
behaves correctly on its own: the switch in **Settings → Notifications** reads
*"Not yet. The part that does the ringing is not set up"* and stays off, rather
than offering a button that cannot work.

---

## 1. Make the key pair

Run this anywhere — it needs nothing but Node, which is already installed:

```bash
npx web-push generate-vapid-keys
```

It prints two strings, a **Public Key** and a **Private Key**.

> **The private key is the project's first real secret.**
> It does not go in this repository, it does not go in `js/config.js`, and it
> does not go in a chat window. Anybody holding it can make every phone that
> ever subscribed to MyMon buzz with any text they like.
>
> The public key is the opposite: it is meant to ship inside every browser.
> It only lets a browser say *"send to me"*, never *"send to them"*.

## 2. Put each half where it belongs

**The public half** goes into `js/config.js`, beside the two values already
there:

```js
vapidPublicKey: 'BK…'      // the Public Key, pasted whole
```

**The private half** goes into Supabase, and nowhere else:

*Dashboard → Project Settings → Edge Functions → Secrets → Add new secret*

| Name                | Value                                       |
| ------------------- | ------------------------------------------- |
| `VAPID_PUBLIC_KEY`  | the same public key as above                |
| `VAPID_PRIVATE_KEY` | the private key                             |
| `VAPID_SUBJECT`     | `mailto:` followed by an email address      |

`VAPID_SUBJECT` is not decoration. The push services at Google, Apple and
Mozilla want somebody to contact if a sender starts behaving badly, and a
sender without one can be refused.

## 3. Put the function on the server

```bash
npx supabase login
npx supabase link --project-ref vhktvysiknrgulxltxqr
npx supabase functions deploy send-push
```

## 4. Make it run on its own

*Dashboard → Integrations → Cron → Create job*

* **Name** — `send-push`
* **Schedule** — every minute
* **Type** — Supabase Edge Function, then pick `send-push`

The dashboard handles the authorisation itself, which is the reason to use it
rather than writing the schedule as SQL by hand: the SQL version needs the
`service_role` key written into the job, and a key stored in a row is a key
that leaks with the first careless backup.

---

## Checking it works

Call the function once by hand from the dashboard, or let a minute pass. It
answers with a count rather than a page:

```json
{ "claimed": 3, "stale": 0, "sent": 4, "forgotten": 0 }
```

* **claimed** — notifications picked up this run
* **stale** — older than six hours, so marked done without sending; a buzz
  about something from yesterday is worse than no buzz
* **sent** — messages actually handed to a push service. Higher than *claimed*
  is normal and correct: one notification goes to every device that person has
* **forgotten** — devices the push service said are gone for good, now deleted

If **sent** is 0 while **claimed** is not, nobody has turned the switch on in
Settings yet, on any device.

## On an iPhone

Notifications only work once MyMon has been added to the home screen from
Safari — Share, then *Add to Home Screen*. In a Safari tab the browser does not
even admit notifications exist, which is why the switch in Settings says so in
those words instead of reporting that the phone cannot do it.

## The day this needs rewriting

If MyMon is ever packaged with Capacitor rather than as a TWA, its WebView has
no Push API and none of this reaches it; that build needs Firebase instead.
What survives untouched is everything except this file: the subscriptions
table, the claiming function, and the rules about who may be told what. Only
the last hop changes.
