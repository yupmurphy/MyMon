# The database, step by step

Every change MyMon's database has ever had, in the order it happened. The file
name starts with the moment it was applied — `YYYYMMDDHHMMSS` — so the list
sorts itself.

Run top to bottom against an empty database and you get the database MyMon is
running on today. That is the whole point of keeping them: *"what shape is the
database in"* has an answer here, instead of only in somebody's memory.

## Two rules

**A migration that has already run is never edited.** Not to tidy it, not to
fix it. If something needs changing, that is a new file. Edit an old one and
two databases built from the same folder quietly end up different — which is
the one thing this folder exists to prevent. (Comments are the exception: the
headers here were corrected when the files moved, because they still told you
to paste them into the SQL editor.)

**Not every migration can be run twice.** Most of these only create things that
do not exist yet, so running them again changes nothing. But
`20261001013205_currency_per_expense.sql` also *fills in* the currency on rows
that were written before that column existed, and it decides what to put there
by looking at the owner's chosen currency. Run it a second time, on a day when
you have a genuine dollar expense and lei set in your account, and it will
quietly turn that expense into lei. It is a one-time step, and it is written
down as already taken.

## What the database itself knows

Supabase keeps its own list, in `supabase_migrations.schema_migrations`. The
first three files here were applied by hand, pasted into the SQL editor before
that list was being kept, so they were added to it afterwards **as already
done** — without being run again. That is what stops the currency backfill
above from ever being replayed.

To see the list:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

It should name the same four files as this folder.
