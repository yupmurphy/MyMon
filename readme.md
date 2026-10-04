# MyMon — v1.1.26

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
dashboard.html       the app (signed in) — two tabs: Personal and Groups
settings.html        your name, your username, your currency
about.html           what MyMon does and does not do
style.css            design tokens, both themes, and every component
js/config.js         which Supabase project to talk to
js/session.js        signing in with Google, and who is signed in
js/data.js           categories, validation, monthly statistics, database access
js/groups.js         the same, for groups: members, group expenses, comments
js/ui.js             money formatting, toasts, chart tooltips, header, theme button
js/xlsx.js           writes the export file: a real .xlsx, not a .csv
js/landing.js        landing page behaviour
js/welcome.js        the first-run name and username page
js/dashboard.js      the Personal tab
js/groupboard.js     the two tabs, and everything inside the Groups one
js/settings.js       the settings page
js/profile.js        the public half of an account: name, username, first-run check
js/install.js        the install button, which differs per browser
supabase/migrations/ every change the database has ever had, in order
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
- **App / dashboard** — the default page after login, in two tabs
- **Settings** — name, username, currency
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
so there is nothing to guess about the shape of it. A friends list, so there is nothing
to type from memory at all, comes later.

Every list the Groups tab shows is simply whatever the database was willing to answer
with. Nothing in the JavaScript decides who may see or change anything; the rules live
in `supabase/migrations/20261001145917_groups_and_comments.sql` and nowhere else. A
button that is hidden is hidden because pressing it would be refused anyway.

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
- refunds or loans
- custom categories
- salary cycles
- PDF reports

## Planned, not built yet

- splitting a group total per person
- a friends list, so inviting is not typing a username from memory
- a monthly limit or budget
- repeating an expense

---

## Final note

This project prioritizes clarity, simplicity, and learning. Complexity will be added
only when it brings real value.
