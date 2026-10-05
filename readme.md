# MyMon — v1.3

MyMon is a simple personal expense tracker focused on clarity, not complexity.

> **Note:** MyMon is a working project name. Trademark availability will be checked
> later, and the name may change to MonMom or another alternative if needed.

**Status: v1 is built, and it now has real accounts and groups.** You sign in with
Google, your expenses live in a database, and the same numbers follow you from laptop
to phone.

Since v1: a currency of your choice, expenses you can edit instead of delete and
retype, a search across everything you ever logged, a month-by-month chart, an export
to a real spreadsheet, a dark theme, and **groups** — a shared ledger a few people
write into, with comments on it.

---

## Running it

It is a plain static site — no build step, no dependencies. It does need to be served
over `http`, because signing in redirects back to a real address:

```bash
py -m http.server 4173
```

Then open <http://127.0.0.1:4173/>. Opening `index.html` straight from the file system
will not work any more; signing in needs a real address to return to.

## Files

```
index.html           landing page (public)
welcome.html         the first screen after a first sign-in: name and username
dashboard.html       the app (signed in) — three tabs: Personal, Groups, Friends
settings.html        three tabs: Profile, Account, Notifications
about.html           what MyMon does and does not do
style.css            design tokens, both themes, and every component
js/config.js         which Supabase project to talk to
js/session.js        signing in with Google, and who is signed in
js/data.js           categories, validation, monthly statistics, database access
js/groups.js         the same, for groups: members, group expenses, comments
js/friends.js        the same, for friends: asking, answering, the list
js/ui.js             money formatting, toasts, chart tooltips, header, theme button
js/xlsx.js           writes the export file: a real .xlsx, not a .csv
js/landing.js        landing page behaviour
js/welcome.js        the first-run name and username page
js/dashboard.js      the Personal tab
js/groupboard.js     the three tabs, and everything inside the Groups one
js/friendboard.js    everything inside the Friends one
js/settings.js       the settings page
js/profile.js        the public half of an account: name, username, first-run check
js/install.js        the install button, which differs per browser
js/push.js           asking a browser to ring this device, and recording it
supabase/migrations/ every change the database has ever had, in order
supabase/functions/  the one piece that runs on a server, not in a browser
vendor/supabase.js   the Supabase library, kept here so no CDN can take MyMon down
tools/make_icons.py  redraws the app icons from the logo
manifest.webmanifest what the phone needs to install MyMon
sw.js                service worker: installable, and it opens on a bad line
icon-*.png           app icons, drawn from the logo
```

`js/session.js`, `js/data.js`, `js/groups.js` and `js/profile.js` are the only files
that know Supabase exists. Moving to a different provider later means rewriting those
four — nothing else has to change.

## The database

`supabase/migrations/` holds every change the database has ever had, one file per
change, named for the moment it was applied. Run them top to bottom against an empty
project and you get the database MyMon runs on today. Two rules live in
`supabase/migrations/README.md` and matter: **a migration that has already run is
never edited**, and one of them must **never be run twice** (it fills in a currency,
and a second pass would overwrite real values).

What is in there now:

| Migration | What it added |
|---|---|
| `expenses` | the one table: an expense belongs to exactly one account |
| `profiles_and_usernames` | usernames, unique, with an availability check |
| `currency_per_expense` | a currency on each expense — the one-time one |
| `pin_search_path_on_touch_updated_at` | closed a small hole in a trigger |
| `groups_and_comments` | groups, members, group expenses, comments |
| `lock_down_the_trigger_functions` | took the triggers off the public web API |
| `name_on_the_profile` | first and last name, where a group can read them |
| `pin_search_path_on_username_available` | the last function brought into line |
| `notifications` | the bell: a table nobody's browser may write to |
| `friends` | one row per pair, and the asymmetry about who may see whom |
| `friend_handle` | the username on the request, so a waiting list has a name |
| `push_subscriptions` | the devices to ring, and the rule for one that changed hands |
| `claim_push_batch` | handing a batch to the sender without sending it twice |

## Connecting it to your own Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the files in `supabase/migrations/` in order, oldest
   first. They create the tables and the rules that decide who may read what.
3. Create an OAuth client in the Google Cloud Console (type: *Web application*) and give
   it the callback address shown in Supabase under
   **Authentication → Providers → Google**. Paste the client id and secret back there and
   enable the provider.
4. Under **Authentication → URL Configuration**, add every address the app runs at, for
   example `http://127.0.0.1:4173/**`.
5. Put the project URL and the public key into `js/config.js`.

Both values in `js/config.js` are meant to be public — they reach every browser that
opens the site. What protects the data is the Row Level Security from step 2. The
`service_role` key is a different thing entirely and must never go near this folder.

---

## What MyMon is

- A small tool to track personal expenses
- Focused on monthly spending clarity
- Built to grow later, without overengineering now
- Not a full finance system

## Target & scope

- **Initial users:** me and close friends
- **Language:** English
- **Focus:** expenses only (no income)

## Pages

- **Landing page** — visible only to non-authenticated users
- **Welcome** — once, after a first sign-in: your name, and the username people find
  you by. Skipped for good once it has been filled in.
- **App / dashboard** — the default page after login, in three tabs: **Personal**
  (what you spent), **Groups** (what you spent together) and **Friends** (who you can
  invite without typing a username)
- **Settings** — three tabs, split by what you came to change:
  - **Profile** — the name MyMon greets you with, and the username people find you by
  - **Account** — the currency new expenses are written in, the Google account behind
    it all, and the download
  - **Notifications** — one switch per kind of notification. No Save button: the switch
    is the answer, so pressing it is what saves it. The four live on your profile
    rather than in the browser, because the database triggers that create a
    notification are the ones that have to read them. Below them sits a different
    kind of switch: whether **this** device also buzzes while MyMon is closed. That
    one is per device, not per account, and it says plainly when it cannot work —
    on an iPhone, until MyMon is on the home screen, it cannot
- **About** — the short version of this file, for someone who is not reading the repo

## User flow

1. User enters the site.
2. If not logged in, they see the landing page. If logged in, they go straight to the
   dashboard.
3. First time only: the welcome page asks for a first name, a last name and a username.
   Google hands over a single name string and no way to ask for the two halves
   separately, so MyMon guesses where the seam is, shows the guess in two fields, and
   lets the person correct it. The username is suggested from the name and checked to
   be free before it is shown.
4. The dashboard shows their name and a clear message:
   *"This month you have spent $X"* or *"Last month you spent $X"*.
5. User clicks **Add expense** and fills the form.
6. Totals and statistics update instantly.

## Transaction definition

A transaction contains:

- category
- amount
- date
- optional comment
- currency — the one chosen at the time it was written

**Validation rules**

- amount must be at least 0.01 and at most 999,999.99
- amount cannot be negative, and carries at most two decimals
- date cannot be in the future, and cannot be more than 20 years ago
- comment is optional, up to 140 characters

An expense can be edited after the fact, and deleting one can be undone.

## Groups

A group is a few people and a ledger they all write into.

**A group expense is its own row, never a view of a personal one.** There are two ways
one gets there, and both are deliberate:

1. **Typed straight into the group** — for something that has no business in your
   personal list at all.
2. **Copied from a personal expense** — the row is duplicated into the group. The two
   are independent from that moment on: editing or deleting one leaves the other alone.

That is the whole design. A personal expense is never in a group by accident, the
choice of where it goes is always on screen, and **the database never has to let
anybody read anybody else's personal expenses** — because there is nothing of yours in
a group that was not put there on purpose. A copy remembers where it came from, so the
same expense cannot be copied into the same group twice.

**Who may do what**

| | Owner | Member | Invited | Everyone else |
|---|---|---|---|---|
| See the group's name | yes | yes | yes | no |
| See its expenses and comments | yes | yes | no | no |
| Add an expense to it | yes | yes | no | no |
| Edit or delete **their own** expense | yes | yes | — | no |
| Edit or delete someone else's | no | no | no | no |
| Invite someone | yes | no | no | no |
| Remove a member | yes | no | no | no |
| Rename or delete the group | yes | no | no | no |
| Leave | no — delete it instead | yes | — | — |

**Leaving does not take your entries with you.** If five people split an event and one
of them walks away, the total still has to be the total. What leaving costs you is the
right to read the group and write to it, and nothing else.

You can change or delete your own entries at any time without leaving the group.

Invitations are by username — you type `@someone`, and the `@` is already in the field
so there is nothing to guess about the shape of it. Your friends appear above that box
as things to press, so after the first time there is nothing to remember.

Every list the Groups tab shows is simply whatever the database was willing to answer
with. Nothing in the JavaScript decides who may see or change anything; the rules live
in `supabase/migrations/20261001145917_groups_and_comments.sql` and nowhere else. A
button that is hidden is hidden because pressing it would be refused anyway.

Inside a group, the list of what was spent narrows two ways: **who paid**, and
**on what**. The figure for whatever is left appears above the list, so "how much
did Ana put in on food" is two taps and a number rather than arithmetic.

Only what is actually in the group gets a chip. A *Transport* filter in a group
where nobody has taken a bus is a button whose only possible outcome is an empty
list, and the whole bar is left out when there is one person and one category —
nothing to narrow. The filters are forgotten when you leave the group, because a
filter that survived into the next one would show an empty screen whose reason is
two taps behind you.

This is narrowing a list, and that is all it is. It does not divide anything by
the number of people, and nothing anywhere says who owes whom — see the list of
what MyMon does not do.

Your groups are ordered by the one **you** last spent from. Not by anybody's activity —
that would reshuffle the list under your finger every time somebody else added forty
lei. Keyed on your own doing, it only moves when you move it.

## Friends

A friends list exists for one reason: so that inviting somebody to a group is picking a
name rather than remembering a username.

You add somebody by username; they decide. Until they say yes, nothing of theirs is
shown to you — not even their name. The other way round is not symmetric, and that is
deliberate: **the person being asked can see who is asking**, because they have to know
that before they can answer. The asker already knows the username, because they typed
it, and a real name is the other person's to give.

Underneath there is **one row per pair**, with the two account ids always stored in the
same order. That makes the pair the primary key, so the database itself refuses a
duplicate, and "are we already friends" and "did one of us already ask" become the same
question with one answer. Two people pressing add in the same second cannot end up with
two rows that each think they are the request.

No browser can write a friendship. A request goes through a database function that takes
a *username* and hands back a word, so the browser never learns an account id it did not
already have. Accepting is an ordinary update, policed by a trigger: the identity of a
row is frozen, accepted is a one-way door, and the person who asked is not allowed to be
the person who answers. Declining, taking an unanswered request back, and unfriending
are all the same act — the row should not exist — and either person may do it.

The rules live in `supabase/migrations/20261004230000_friends.sql`.

## Notifications

There are two halves, and they fail independently on purpose.

**The bell**, inside MyMon, is a table no browser may write to. Rows appear
only from triggers, which read the four switches in Settings before writing
anything — so a switch turned off is not a filter on what you see, it is a
notification that was never made. The bell needs nothing but the app being
open.

**The phone**, while MyMon is closed, is the other half. A browser hands out a
*subscription*: an address that forwards to one device, plus two keys so the
forwarder cannot read what passes through. That is a capability, not a
preference — whoever holds it can make that device buzz — so it is written
only by a database function, never by a browser, and read by nobody but its
owner and the sender.

The function deletes any earlier claim on the same address before recording a
new one. A phone changes hands: you sign out, somebody else signs in, and the
address is still the same address. Whoever is signed in now owns it.

There is no "ring my phone" column anywhere. The presence of a subscription
**is** the switch, which is why turning it off is deleting a row, and why the
control in Settings is per device rather than per account — your phone and
your laptop each answer for themselves.

The sending runs on a timer rather than on a trigger, because a trigger would
make every comment wait for several HTTP requests before it was saved. A buzz
a minute late costs nothing; a comment that takes two seconds to post costs
every time.

`supabase/functions/send-push/README.md` is the setup, and the three steps in
it are the owner's: the private key is the project's first real secret and
belongs in Supabase, never here.

**Not in groups yet:** splitting a total per person ("what did this cost for X
people"). It is coming as its own feature.

## Month logic

- Months are calendar-based
- Month is derived from the transaction date (`YYYY-MM`)
- No month closing logic
- No background jobs
- No custom salary cycles

## Categories

Fixed list, including an **Other** category. Users cannot create custom categories.

`Food · Bills · Transport · Entertainment · Hobby · Shopping · Other`

Each category owns a fixed colour, and the order of the list *is* the colour order: the
palette was validated in that exact sequence, so neighbouring categories stay
distinguishable for colour-blind readers. There are two validated palettes, one per
theme — the light set genuinely fails against a dark surface, so the dark one was
chosen and checked separately rather than flipped automatically. Every colour is always
paired with a written label; the charts never rely on colour alone.

It is also why custom categories are not planned: a colour nobody checked would walk
straight into that sequence.

## Statistics displayed

For a selected month:

- total amount spent
- total per category (sum)
- percentage per category
- a simple visual diagram, drawn by hand — no external chart libraries
- the comparison with the month before, the number of expenses, the average per
  active day and the biggest single expense

Beyond one month:

- a month-by-month chart of what came before
- a search across every expense ever logged, by note, amount or date
- an export of the lot as a spreadsheet (`.xlsx`, written by `js/xlsx.js`)

## Appearance

Light and dark. With nothing chosen, MyMon follows the system setting; the button in
the header overrules it, per device, and the choice is remembered. The theme is applied
before the first pixel is painted, so a dark-theme user never gets a white flash on the
way in.

## UI / UX principles

- Minimal text
- Plenty of white space
- Clean overview
- Details only on demand
- One main action: **Add expense**

## Technical approach

- Start with clear structure
- Build functional frontend first
- ~~Simulate backend locally~~ — done in v1, replaced in v1.1
- Add real backend and database later — **done**

Accounts are Google accounts: MyMon never sees, asks for or stores a password.
Expenses are rows in Postgres, and the database itself refuses to hand a row to anyone
who has no business with it — your personal expenses to anybody but you, a group's
expenses to anybody who is not in that group.

Everything you are allowed to see is fetched once when the app opens and kept in
memory, so switching months, adding up categories and moving between groups stay
instant. Only the calls that *change* something wait on the server. Expenses left
behind in the browser by v1 are offered for import the first time you sign in.

## Explicitly out of scope

- income tracking
- splitting a group total per person, or who owes whom — a group answers what
  was spent together, and that is the whole of it
- refunds or loans
- custom categories
- salary cycles
- PDF reports

## Planned, not built yet

- a monthly limit or budget
- repeating an expense

---

## Final note

This project prioritizes clarity, simplicity, and learning. Complexity will be added
only when it brings real value.
