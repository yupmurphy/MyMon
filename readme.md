# MyMon — v1

MyMon is a simple personal expense tracker focused on clarity, not complexity.

> **Note:** MyMon is a working project name. Trademark availability will be checked
> later, and the name may change to MonMom or another alternative if needed.

**Status: v1 is built.** Everything in the scope below is implemented, front-end only,
with the data stored in the browser.

---

## Running it

It is a plain static site — no build step, no dependencies.

```bash
py -m http.server 4173
```

Then open <http://127.0.0.1:4173/>. Opening `index.html` directly from the file system
also works in most browsers, but a local server is the reliable way.

## Files

```
index.html       landing page (public)
dashboard.html   the app (signed in)
about.html       what v1 does and does not do
style.css        design tokens + every component
js/data.js       categories, storage, validation, monthly statistics
js/session.js    the simulated login
js/ui.js         money formatting, toasts, chart tooltips, header
js/landing.js    landing page behaviour
js/dashboard.js  the dashboard
```

`js/data.js` and `js/session.js` are the only files that touch storage. When a real
backend arrives, those two are what gets rewritten — nothing else has to change.

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
- Simulate backend locally
- Add real backend and database later

There is no password and no account. "Signing in" only means the browser remembers a
name, and expenses live in `localStorage` under `mymon.transactions.v1`. Clearing
browser data clears the expenses with it.

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
