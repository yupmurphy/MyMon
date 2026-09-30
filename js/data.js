/* MyMon — data layer.
   Categories, local storage, validation and monthly statistics.
   This is the only file that knows how a transaction is shaped, so the day a
   real backend arrives, only the read/write functions here have to change. */
window.MyMon = window.MyMon || {};

(function (NS) {
  'use strict';

  var STORE_KEY = 'mymon.transactions.v1';

  /* Fixed categories. The array order is also the colour order: the palette was
     validated in this exact sequence for colour-blind separation, so segments
     sit next to each other safely in the share bar. Do not reorder casually. */
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

  /* ---------- storage ----------------------------------------------------- */

  var memoryFallback = null;   /* used when localStorage is unavailable */

  function read() {
    if (memoryFallback) return memoryFallback.slice();
    var raw;
    try {
      raw = window.localStorage.getItem(STORE_KEY);
    } catch (err) {
      memoryFallback = [];
      return [];
    }
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isWellFormed) : [];
    } catch (err) {
      return [];
    }
  }

  function write(list) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(list));
    } catch (err) {
      memoryFallback = list.slice();
    }
  }

  function isWellFormed(tx) {
    return tx && typeof tx === 'object' &&
      typeof tx.id === 'string' &&
      typeof tx.amount === 'number' && isFinite(tx.amount) && tx.amount > 0 &&
      !!categoryById(tx.category) &&
      isValidDateKey(tx.date);
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'tx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* Newest first; ties broken by entry order so a correction lands on top. */
  function sorted(list) {
    return list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || '') < (a.createdAt || '') ? -1 : 1;
    });
  }

  function all() { return sorted(read()); }

  function forMonth(monthKey) {
    return all().filter(function (tx) { return monthOf(tx.date) === monthKey; });
  }

  /* ---------- validation --------------------------------------------------
     Rules come straight from the v1 spec:
       amount  at least 0.01, never negative, at most two decimals
       date    never in the future, and only this month or last month
       comment optional
     Returns { ok, errors, value } — errors is keyed by field name. */

  function validate(input) {
    var errors = {};
    var value = {};

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
        errors.amount = 'The amount has to be at least $0.01.';
      } else if (amount > MAX_AMOUNT) {
        errors.amount = 'That is over the $999,999.99 limit.';
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
    } else if (monthOf(date) !== currentMonth() && monthOf(date) !== previousMonth()) {
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

  /* ---------- writes ------------------------------------------------------ */

  function add(input) {
    var result = validate(input);
    if (!result.ok) return result;

    var tx = {
      id: newId(),
      amount: result.value.amount,
      category: result.value.category,
      date: result.value.date,
      comment: result.value.comment,
      createdAt: new Date().toISOString()
    };

    var list = read();
    list.push(tx);
    write(list);

    result.tx = tx;
    return result;
  }

  function remove(id) {
    var list = read();
    var removed = null;
    var kept = list.filter(function (tx) {
      if (tx.id === id) { removed = tx; return false; }
      return true;
    });
    write(kept);
    return removed;
  }

  function restore(tx) {
    if (!isWellFormed(tx)) return false;
    var list = read();
    list.push(tx);
    write(list);
    return true;
  }

  /* ---------- statistics --------------------------------------------------
     Everything the dashboard needs for one month, in one pass. */

  function statsFor(monthKey) {
    var list = forMonth(monthKey);
    var totals = {};
    var total = 0;

    list.forEach(function (tx) {
      totals[tx.category] = (totals[tx.category] || 0) + tx.amount;
      total += tx.amount;
    });

    total = Math.round(total * 100) / 100;

    /* Kept in CATEGORIES order so the share bar keeps its validated colour
       sequence; the dashboard sorts a copy by size for the written breakdown. */
    var byCategory = CATEGORIES
      .filter(function (cat) { return totals[cat.id] > 0; })
      .map(function (cat) {
        var sum = Math.round(totals[cat.id] * 100) / 100;
        return {
          category: cat,
          total: sum,
          percent: total > 0 ? (sum / total) * 100 : 0
        };
      });

    var days = {};
    list.forEach(function (tx) { days[tx.date] = true; });
    var dayCount = Object.keys(days).length;

    return {
      month: monthKey,
      transactions: list,
      count: list.length,
      total: total,
      byCategory: byCategory,
      biggest: list.reduce(function (best, tx) {
        return !best || tx.amount > best.amount ? tx : best;
      }, null),
      perDay: dayCount ? Math.round((total / dayCount) * 100) / 100 : 0
    };
  }

  /* Oldest month that holds data. */
  function earliestMonth() {
    var list = read();
    if (!list.length) return currentMonth();
    var oldest = list[0].date;
    list.forEach(function (tx) { if (tx.date < oldest) oldest = tx.date; });
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
    picks.forEach(function (pick) {
      var date = new Date();
      date.setDate(date.getDate() - pick[2]);
      var key = toKey(date);
      if (key < floor) return;
      add({ amount: pick[1], category: pick[0], date: key, comment: pick[3] });
    });
  }

  function clearAll() { write([]); }

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
    all: all,
    forMonth: forMonth,
    validate: validate,
    add: add,
    remove: remove,
    restore: restore,
    statsFor: statsFor,
    seedSample: seedSample,
    clearAll: clearAll
  };
})(window.MyMon);
