# MyMon — v1.1.6

MyMon is a simple personal expense tracker focused on clarity, not complexity.

> **Note:** MyMon is a working project name. Trademark availability will be checked
> later, and the name may change to MonMom or another alternative if needed.

**Status: v1 is built, and it now has real accounts.** Everything in the scope below is
implemented. You sign in with Google and your expenses live in a database, so the same
numbers follow you from laptop to phone.

Since then: a currency of your choice, expenses you can edit rather than delete and
retype, and the Supabase library kept in this repository so a content network going
down cannot stop MyMon from starting.

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
dashboard.html       the app (signed in)
settings.html        your name, your username, your currency
about.html           what v1 does and does not do
style.css            design tokens + every component
js/config.js         which Supabase project to talk to
js/session.js        signing in with Google, and who is signed in
js/data.js           categories, validation, monthly statistics, database access
js/ui.js             money formatting, toasts, chart tooltips, header
js/landing.js        landing page behaviour
js/dashboard.js      the dashboard
js/settings.js       the settings page
js/profile.js        the username: validating, checking, claiming it
js/install.js        the install button, which differs per browser
supabase/schema.sql  the table and the access rules, to run once per project
supabase/profiles.sql usernames: the table, its rules, and the availability check
supabase/currency.sql the currency column, to run once after schema.sql
vendor/supabase.js   the Supabase library, kept here so no CDN can take MyMon down
manifest.webmanifest what the phone needs to install MyMon
sw.js                service worker: installable, and it opens on a bad line
icon-*.png           app icons, drawn from the logo
```

`js/session.js` and `js/data.js` are the only files that know Supabase exists. Moving to
a different provider later means rewriting those two — nothing else has to change.

## Connecting it to your own Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste all of `supabase/schema.sql`, press **Run**. This creates
   the table and the rules that keep each person's expenses to themselves.
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

## What MyMon v1 is

- A small tool to track personal expenses
- Focused on monthly spending clarity
- Built to grow later, without overengineering now
- Not a social network (yet)
- Not a full finance system

## Target & scope

- **Initial users:** me and close friends
- **Language:** English
- **Focus:** expenses only (no income in v1)

## Pages

- **Landing page** — visible only to non-authenticated users
- **App / dashboard** — the default page after login

## User flow

1. User enters the site.
2. If not logged in, they see the landing page. If logged in, they go straight to the dashboard.
3. The dashboard shows their name or nickname and a clear message:
   *"This month you have spent $X"* or *"Last month you spent $X"*.
4. User clicks **Add expense** and fills the form.
5. Totals and statistics update instantly.

## Transaction definition (v1)

A transaction contains:

- category
- amount
- date
- optional comment

**Validation rules**

- amount must be at least $0.01
- amount cannot be negative
- date cannot be in the future
- date can be from the current month or the previous month
- comment is optional

## Month logic

- Months are calendar-based
- Month is derived from the transaction date (`YYYY-MM`)
- No month closing logic
- No background jobs
- No custom salary cycles in v1

## Categories

Fixed list, including an **Other** category. Users cannot create custom categories in v1.

`Food · Bills · Transport · Entertainment · Hobby · Shopping · Other`

Each category owns a fixed colour. The colour order was picked so that neighbouring
categories stay distinguishable for colour-blind readers, and every colour is always
paired with a written label — the charts never rely on colour alone.

## Statistics displayed (v1)

For a selected month:

- total amount spent
- total per category (sum)
- percentage per category
- a simple visual diagram, drawn by hand — no external chart libraries
- plus: the comparison with the month before, the number of expenses, the average per
  active day and the biggest single expense

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

Accounts are Google accounts: MyMon never sees, asks for or stores a password. Expenses
are rows in Postgres, and the database itself refuses to hand a row to anyone but the
person who created it.

Everything is fetched once when the app opens and kept in memory, so switching months
and adding up categories stay instant. Only adding, deleting and undoing wait on the
server. Expenses left behind in the browser by v1 are offered for import the first time
you sign in.

## Explicitly out of scope for v1

- income tracking
- refunds or loans
- friends or group features
- custom categories
- salary cycles
- PDF or export reports

---

## Final note

This project prioritizes clarity, simplicity, and learning. Complexity will be added
only when it brings real value.
