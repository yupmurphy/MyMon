/* MyMon — data layer.
   Categories, validation and monthly statistics, plus everything that talks to
   the database.

   The expenses are fetched once when the app opens and kept in memory. Reading
   a month, adding up a category or switching months therefore stays instant and
   synchronous, exactly as it was before; only the four functions that *change*
   something have to wait for the server. */
window.MyMon = window.MyMon || {};

(function (NS) {
  'use strict';

  var TABLE = 'transactions';
  var LEGACY_KEY = 'mymon.transactions.v1';   /* the v1 browser-only storage */

  /* Fixed categories. The array order is also the colour order: the palette was
     validated in this exact sequence for colour-blind separation, so segments
     sit next to each other safely in the share bar. Do not reorder casually.
     Changing the ids here means changing the check constraint in
     supabase/schema.sql too. */
  var CATEGORIES = [
    { id: 'food',          label: 'Food',          icon: '\u{1F34E}', color: '#2a78d6' },
    { id: 'bills',         label: 'Bills',         icon: '\u{1F9FE}', color: '#eb6834' },
    { id: 'transport',     label: 'Transport',     icon: '\u{1F68C}', color: '#1baf7a' },
    { id: 'entertainment', label: 'Entertainment', icon: '\u{1F3AC}', color: '#eda100' },
    { id: 'hobby',         label: 'Hobby',         icon: '\u{1F3A8}', color: '#e87ba4' },
    { id: 'other',         label: 'Other',         icon: '\u{1F4E6}', color: '#4a3aa7' },
    { id: 'shopping',      label: 'Shopping',      icon: '\u{1F6CD}️', color: '#e34948' }
  ];

  var MIN_AMOUNT = 0.01;
  var MAX_AMOUNT = 999999.99;
  var MAX_COMMENT = 140;

  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  /* ---------- dates -------------------------------------------------------
     Everything is local time. Date strings are plain 'YYYY-MM-DD' and are never
     fed to new Date(string), which would read them as UTC and shift the day. */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function toKey(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function today() { return toKey(new Date()); }

  function monthOf(dateKey) { return String(dateKey).slice(0, 7); }

  function currentMonth() { return monthOf(today()); }

  function shiftMonth(monthKey, delta) {
    var year = parseInt(monthKey.slice(0, 4), 10);
    var month = parseInt(monthKey.slice(5, 7), 10) - 1 + delta;
    year += Math.floor(month / 12);
    month = ((month % 12) + 12) % 12;
    return year + '-' + pad(month + 1);
  }

  function previousMonth() { return shiftMonth(currentMonth(), -1); }

  function monthLabel(monthKey) {
    return MONTH_NAMES[parseInt(monthKey.slice(5, 7), 10) - 1] + ' ' + monthKey.slice(0, 4);
  }

  /* 'This month' / 'Last month' / 'July 2026' */
  function monthLabelRelative(monthKey) {
    if (monthKey === currentMonth()) return 'This month';
    if (monthKey === previousMonth()) return 'Last month';
    return monthLabel(monthKey);
  }

  function dayLabel(dateKey) {
    if (dateKey === today()) return 'Today';
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (dateKey === toKey(yesterday)) return 'Yesterday';
    var day = parseInt(dateKey.slice(8, 10), 10);
    return day + ' ' + MONTH_NAMES[parseInt(dateKey.slice(5, 7), 10) - 1].slice(0, 3) +
      (dateKey.slice(0, 4) === today().slice(0, 4) ? '' : ' ' + dateKey.slice(0, 4));
  }

  function isValidDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var year = +value.slice(0, 4), month = +value.slice(5, 7), day = +value.slice(8, 10);
    var probe = new Date(year, month - 1, day);
    return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
  }

  /* ---------- categories -------------------------------------------------- */

  function categoryById(id) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].id === id) return CATEGORIES[i];
    }
    return null;
  }

  /* Same list, but with 'Other' pushed to the end — the natural reading order
     for a picker, while CATEGORIES keeps the validated colour order. */
  function categoriesForPicker() {
    var rest = CATEGORIES.filter(function (c) { return c.id !== 'other'; });
    return rest.concat(CATEGORIES.filter(function (c) { return c.id === 'other'; }));
  }

  /* ---------- the database ------------------------------------------------ */

  var cache = [];       /* every expense of the signed-in user */
  var loaded = false;

  /* Every read asks for the same columns; naming them once keeps the list and
     fromRow() from drifting apart. */
  var SELECT = 'id, amount, category, spent_on, currency, comment, created_at';

  function table() {
    var client = NS.session && NS.session.client;
    if (!client) throw new Error('MyMon is not connected to the database.');
    return client.from(TABLE);
  }

  /* database row  ->  the shape the rest of the app speaks */
  function fromRow(row) {
    return {
      id: row.id,
      amount: Number(row.amount),
      category: row.category,
      date: row.spent_on,
      currency: (NS.ui ? NS.ui.cleanCurrency(row.currency) : (row.currency || 'USD')),
      comment: row.comment || '',
      createdAt: row.created_at
    };
  }

  /* ...and back. user_id is left out on purpose: the database fills it in from
     whoever is signed in, so a browser cannot write a row onto someone else. */
  function toRow(tx) {
    return {
      amount: tx.amount,
      category: tx.category,
      spent_on: tx.date,
      currency: (NS.ui ? NS.ui.cleanCurrency(tx.currency) : (tx.currency || 'USD')),
      comment: tx.comment || ''
    };
  }

  function isWellFormed(tx) {
    return tx && typeof tx === 'object' &&
      typeof tx.amount === 'number' && isFinite(tx.amount) && tx.amount > 0 &&
      !!categoryById(tx.category) &&
      isValidDateKey(tx.date);
  }

  /* Newest first; ties broken by entry order so a correction lands on top. */
  function sortCache() {
    cache.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || '') < (a.createdAt || '') ? -1 : 1;
    });
  }

  /* Fetch everything once. Called by the dashboard before the first render. */
  function load() {
    return table()
      .select(SELECT)
      .order('spent_on', { ascending: false })
      .then(function (result) {
        if (result.error) throw result.error;
        cache = (result.data || []).map(fromRow);
        sortCache();
        loaded = true;
        return cache.slice();
      });
  }

  function isLoaded() { return loaded; }

  function all() { return cache.slice(); }

  function forMonth(monthKey) {
    return cache.filter(function (tx) { return monthOf(tx.date) === monthKey; });
  }

  /* ---------- validation --------------------------------------------------
     Rules come straight from the v1 spec:
       amount  at least 0.01, never negative, at most two decimals
       date    never in the future, and only this month or last month
       comment optional
     The database repeats the amount, category and comment rules as constraints,
     so a bug here cannot write nonsense. The month window stays here only: it
     depends on today's date, which the database cannot check.
     Returns { ok, errors, value } — errors is keyed by field name. */

  /* `allowDate` is the date an expense already has. Editing one must never be
     blocked by the window rule below just for leaving its own date alone. */
  function validate(input, allowDate) {
    var errors = {};
    var value = {};

    /* The limits are written in whatever currency the person chose. */
    var write = (NS.ui && NS.ui.money) ? NS.ui.money : function (n) { return '$' + n; };

    var rawAmount = String(input.amount == null ? '' : input.amount).trim().replace(',', '.');
    if (rawAmount === '') {
      errors.amount = 'Enter an amount.';
    } else if (rawAmount.charAt(0) === '-') {
      errors.amount = 'An expense cannot be negative.';
    } else if (!/^\d*\.?\d*$/.test(rawAmount)) {
      errors.amount = 'Use digits only, for example 12.50';
    } else {
      var amount = parseFloat(rawAmount);
      if (!isFinite(amount)) {
        errors.amount = 'That is not a number.';
      } else if (amount < MIN_AMOUNT) {
        errors.amount = 'The amount has to be at least ' + write(MIN_AMOUNT) + '.';
      } else if (amount > MAX_AMOUNT) {
        errors.amount = 'That is over the ' + write(MAX_AMOUNT) + ' limit.';
      } else {
        value.amount = Math.round(amount * 100) / 100;
      }
    }

    if (!input.category) {
      errors.category = 'Pick a category.';
    } else if (!categoryById(input.category)) {
      errors.category = 'Unknown category.';
    } else {
      value.category = input.category;
    }

    var date = String(input.date == null ? '' : input.date).trim();
    if (!date) {
      errors.date = 'Pick a date.';
    } else if (!isValidDateKey(date)) {
      errors.date = 'That date does not exist.';
    } else if (date > today()) {
      errors.date = 'The date cannot be in the future.';
    } else if (date !== allowDate &&
               monthOf(date) !== currentMonth() && monthOf(date) !== previousMonth()) {
      errors.date = 'In v1 you can only log this month or last month.';
    } else {
      value.date = date;
    }

    var comment = String(input.comment == null ? '' : input.comment).trim();
    if (comment.length > MAX_COMMENT) {
      errors.comment = 'Keep it under ' + MAX_COMMENT + ' characters.';
    } else {
      value.comment = comment;
    }

    var ok = true;
    for (var key in errors) { if (Object.prototype.hasOwnProperty.call(errors, key)) { ok = false; } }
    return { ok: ok, errors: errors, value: value };
  }

  /* ---------- writes ------------------------------------------------------
     Each one resolves with the same { ok, errors, tx } shape as before, or
     rejects when the server refuses — the dashboard turns that into a toast. */

  function add(input) {
    var result = validate(input);
    if (!result.ok) return Promise.resolve(result);

    /* Stamped now and never touched again: this is the currency the money was
       actually spent in. */
    result.value.currency = NS.ui ? NS.ui.currencyCode() : 'USD';

    return table()
      .insert(toRow(result.value))
      .select(SELECT)
      .single()
      .then(function (response) {
        if (response.error) throw response.error;
        var tx = fromRow(response.data);
        cache.push(tx);
        sortCache();
        result.tx = tx;
        return result;
      });
  }

  /* A database that has not been brought up to date fails with a message no
     one can act on ("column transactions.currency does not exist"). This turns
     the one case we cause ourselves into an instruction. */
  function setupHint(error) {
    if (!error) return null;
    var text = String(error.message || '') + ' ' + String(error.code || '');
    if (/currency/i.test(text) && /(does not exist|42703|schema cache)/i.test(text)) {
      return 'This project needs one more step: run supabase/currency.sql in the ' +
        'Supabase SQL Editor, then reload.';
    }
    return null;
  }

  function find(id) {
    for (var i = 0; i < cache.length; i++) {
      if (cache[i].id === id) return cache[i];
    }
    return null;
  }

  /* Editing rewrites the row in place, so the expense keeps its id — unlike
     undo, which writes a fresh one. Once expenses can carry comments from
     friends, that id is what those comments will hang on. */
  function update(id, input) {
    var current = find(id);
    if (!current) return Promise.reject(new Error('That expense is no longer here.'));

    var result = validate(input, current.date);
    if (!result.ok) return Promise.resolve(result);

    /* An edit corrects what was spent, not what it was spent in — changing
       the setting later must not turn an old 800 lei into 800 dollars. */
    result.value.currency = current.currency;

    return table()
      .update(toRow(result.value))
      .eq('id', id)
      .select(SELECT)
      .single()
      .then(function (response) {
        if (response.error) throw response.error;

        var tx = fromRow(response.data);
        for (var i = 0; i < cache.length; i++) {
          if (cache[i].id === id) { cache[i] = tx; break; }
        }
        sortCache();
        result.tx = tx;
        return result;
      });
  }

  function remove(id) {
    var index = -1;
    for (var i = 0; i < cache.length; i++) {
      if (cache[i].id === id) { index = i; break; }
    }
    if (index === -1) return Promise.resolve(null);

    var removed = cache[index];

    return table()
      .delete()
      .eq('id', id)
      .then(function (response) {
        if (response.error) throw response.error;
        cache.splice(index, 1);
        return removed;
      });
  }

  /* Undo. The row is written again rather than resurrected, so it comes back
     with a new id — which nothing in the app depends on. */
  function restore(tx) {
    if (!isWellFormed(tx)) return Promise.resolve(null);

    return table()
      .insert(toRow(tx))
      .select(SELECT)
      .single()
      .then(function (response) {
        if (response.error) throw response.error;
        var restored = fromRow(response.data);
        cache.push(restored);
        sortCache();
        return restored;
      });
  }

  function insertMany(rows) {
    if (!rows.length) return Promise.resolve([]);
    return table()
      .insert(rows)
      .select(SELECT)
      .then(function (response) {
        if (response.error) throw response.error;
        var added = (response.data || []).map(fromRow);
        cache = cache.concat(added);
        sortCache();
        return added;
      });
  }

  /* ---------- statistics --------------------------------------------------
     Everything the dashboard needs for one month, in one pass over the cache. */

  function round2(n) { return Math.round(n * 100) / 100; }

  /* Rounding each share on its own is what makes 62.5% and 37.5% print as
     63% and 38% — a chart that adds up to 101%.

     So the whole-number shares are handed out rather than rounded: everyone
     gets the whole part of theirs, and the points left over go to whoever was
     cut back hardest. That is the largest-remainder method, and it always
     totals exactly 100.

     The handing out happens in tenths, so the figures carry one decimal: 62.5%
     and 37.5% are what those two really are, and printing 63% and 38% was
     throwing away a digit that fits on the line perfectly well. A decimal on
     its own would not have been enough — a third of something is 33.3%, and
     three of those make 99.9 — so the method still does the work; the decimal
     only makes it accurate as well as consistent.

     A share too thin to earn even a tenth ends at zero, and the dashboard
     prints that as "<0.1%" rather than "0.0%". The exact fraction stays on
     `percent` for the bar widths, which have no reason to round at all. */
  function shareOutPercent(rows) {
    if (!rows.length) return;

    /* Whole tenths of a percent — integers, so nothing here can drift. */
    var left = 1000;
    rows.forEach(function (row) {
      row.tenths = Math.floor(row.percent * 10);
      left -= row.tenths;
    });

    var byRemainder = rows.slice().sort(function (a, b) {
      return (b.percent * 10 - b.tenths) - (a.percent * 10 - a.tenths);
    });

    for (var i = 0; i < byRemainder.length && left > 0; i++, left--) {
      byRemainder[i].tenths += 1;
    }

    rows.forEach(function (row) { row.shown = row.tenths / 10; });
  }

  /* Everything a month can say about one currency. Totals and percentages only
     mean something inside a single currency — 800 lei plus 20 dollars is not
     820 of anything — so the sums never cross from one to another. */
  function statsForCurrency(list, currency) {
    var totals = {};
    var total = 0;

    list.forEach(function (tx) {
      totals[tx.category] = (totals[tx.category] || 0) + tx.amount;
      total += tx.amount;
    });

    total = round2(total);

    /* Kept in CATEGORIES order so the share bar keeps its validated colour
       sequence; the dashboard sorts a copy by size for the written breakdown. */
    var byCategory = CATEGORIES
      .filter(function (cat) { return totals[cat.id] > 0; })
      .map(function (cat) {
        var sum = round2(totals[cat.id]);
        return {
          category: cat,
          total: sum,
          percent: total > 0 ? (sum / total) * 100 : 0
        };
      });

    shareOutPercent(byCategory);

    var days = {};
    list.forEach(function (tx) { days[tx.date] = true; });
    var dayCount = Object.keys(days).length;

    return {
      currency: currency,
      transactions: list,
      count: list.length,
      total: total,
      byCategory: byCategory,
      biggest: list.reduce(function (best, tx) {
        return !best || tx.amount > best.amount ? tx : best;
      }, null),
      perDay: dayCount ? round2(total / dayCount) : 0
    };
  }

  /* A month, split by currency. `parts` is ordered biggest spend first, so the
     dashboard can lead with the currency that dominated the month. */
  function statsFor(monthKey) {
    var list = forMonth(monthKey);

    var buckets = {};
    var order = [];
    list.forEach(function (tx) {
      if (!buckets[tx.currency]) { buckets[tx.currency] = []; order.push(tx.currency); }
      buckets[tx.currency].push(tx);
    });

    var parts = order.map(function (currency) {
      return statsForCurrency(buckets[currency], currency);
    });

    parts.sort(function (a, b) { return b.total - a.total; });

    var byCurrency = {};
    parts.forEach(function (part) { byCurrency[part.currency] = part; });

    return {
      month: monthKey,
      transactions: list,
      count: list.length,
      currencies: parts.map(function (part) { return part.currency; }),
      parts: parts,
      byCurrency: byCurrency,

      /* The one currency a month is in, or null when it holds more than one. */
      only: parts.length === 1 ? parts[0].currency : null
    };
  }

  /* Oldest month that holds data. */
  function earliestMonth() {
    if (!cache.length) return currentMonth();
    var oldest = cache[0].date;
    cache.forEach(function (tx) { if (tx.date < oldest) oldest = tx.date; });
    var month = monthOf(oldest);
    return month < currentMonth() ? month : currentMonth();
  }

  /* How far back the month stepper may go: to the oldest month with data, and
     never less than last month — that one is still open for new expenses. */
  function floorMonth() {
    var earliest = earliestMonth();
    var previous = previousMonth();
    return earliest < previous ? earliest : previous;
  }

  /* ---------- leftovers from the browser-only version ---------------------
     Expenses logged before there were accounts still sit in this browser. They
     are offered on every load until they are imported, and the local copy is
     dropped once they are safely in the account. */

  function legacyExpenses() {
    var raw;
    try {
      raw = window.localStorage.getItem(LEGACY_KEY);
    } catch (err) {
      return [];
    }
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(function (tx) {
          return {
            amount: Number(tx.amount),
            category: tx.category,
            date: tx.date,
            /* The old browser-only version had no currencies; these amounts are
               whatever the person thinks in today. */
            currency: NS.ui ? NS.ui.currencyCode() : 'USD',
            comment: tx.comment || ''
          };
        })
        .filter(isWellFormed);
    } catch (err) {
      return [];
    }
  }

  function importLegacy() {
    var rows = legacyExpenses().map(toRow);
    return insertMany(rows);
  }

  function forgetLegacy() {
    try {
      window.localStorage.removeItem(LEGACY_KEY);
    } catch (err) { /* nothing to clear */ }
  }

  /* A handful of plausible entries so an empty dashboard can be looked at. */
  function seedSample() {
    var picks = [
      ['food', 42.8, 0, 'Weekly groceries'],
      ['food', 12.4, 1, 'Lunch'],
      ['food', 26.15, 4, ''],
      ['bills', 320, 2, 'Rent share'],
      ['bills', 48.9, 6, 'Electricity'],
      ['transport', 30, 3, 'Monthly pass'],
      ['transport', 14.5, 8, 'Taxi home'],
      ['entertainment', 22, 5, 'Cinema'],
      ['hobby', 65, 9, 'Guitar strings'],
      ['shopping', 89.99, 7, 'Running shoes'],
      ['other', 18, 11, '']
    ];
    var floor = previousMonth() + '-01';
    var rows = [];

    picks.forEach(function (pick) {
      var date = new Date();
      date.setDate(date.getDate() - pick[2]);
      var key = toKey(date);
      if (key < floor) return;
      rows.push({
        amount: pick[1], category: pick[0], spent_on: key, comment: pick[3],
        currency: NS.ui ? NS.ui.currencyCode() : 'USD'
      });
    });

    return insertMany(rows);
  }

  NS.data = {
    CATEGORIES: CATEGORIES,
    MIN_AMOUNT: MIN_AMOUNT,
    MAX_COMMENT: MAX_COMMENT,
    categoryById: categoryById,
    categoriesForPicker: categoriesForPicker,
    today: today,
    monthOf: monthOf,
    currentMonth: currentMonth,
    previousMonth: previousMonth,
    shiftMonth: shiftMonth,
    monthLabel: monthLabel,
    monthLabelRelative: monthLabelRelative,
    dayLabel: dayLabel,
    earliestMonth: earliestMonth,
    floorMonth: floorMonth,
    load: load,
    isLoaded: isLoaded,
    all: all,
    forMonth: forMonth,
    validate: validate,
    find: find,
    setupHint: setupHint,
    add: add,
    update: update,
    remove: remove,
    restore: restore,
    statsFor: statsFor,
    seedSample: seedSample,
    legacyExpenses: legacyExpenses,
    importLegacy: importLegacy,
    forgetLegacy: forgetLegacy
  };
})(window.MyMon);
