-- MyMon — give every expense its own currency.
--
-- RUN THIS ONCE AND ONLY ONCE. Adding the column is harmless to repeat, but
-- the backfill below is not: it fills the currency in from the owner's chosen
-- one, and a second run would catch genuine dollar expenses belonging to
-- somebody whose account says lei, and turn them into lei. It is recorded as
-- already applied for exactly that reason — see README.md.
--
-- Why a column and not a setting: 800 lei spent last week *were* lei. That is
-- a fact about the expense, not a preference about how to show it. Keeping the
-- currency on the row means changing your choice later never rewrites history,
-- and never quietly turns 800 lei into 800 dollars.

-- ---------------------------------------------------------------------------
-- The column. The default only ever applies to a row written by something
-- other than MyMon, which always sends the currency explicitly.
-- ---------------------------------------------------------------------------
alter table public.transactions
  add column if not exists currency text not null default 'USD';

-- Expenses logged before this column existed carry the currency their owner
-- had chosen by then — and plain dollars for anyone who never chose.
update public.transactions t
   set currency = coalesce(upper(nullif(u.raw_user_meta_data ->> 'currency', '')), 'USD')
  from auth.users u
 where u.id = t.user_id
   and t.currency = 'USD';

-- Three capital letters, the same shape ISO currency codes have. The app only
-- ever offers a vetted list; this stops anything else reaching the table.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_currency_check'
  ) then
    alter table public.transactions
      add constraint transactions_currency_check check (currency ~ '^[A-Z]{3}$');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- A quick check. This lists what you have, per currency:
--   select currency, count(*), sum(amount) from public.transactions
--   group by currency order by 3 desc;
-- ---------------------------------------------------------------------------
