/* MyMon — dashboard.
   Waits for the account, loads the expenses once, then paints months out of
   memory. Only adding, deleting and undoing have to talk to the server. */
(function (NS) {
  'use strict';

  var data = NS.data;
  var ui = NS.ui;
  var session = NS.session;

  var user = null;
  var viewMonth = data.currentMonth();
  var dom = {};

  /* The id of the expense being edited, or null when adding a new one. The
     dialog is the same either way — only its labels and its ending differ. */
  var editing = null;

  /* What is typed in the search box. While it holds something the Expenses
     card shows matches from every month instead of the month being viewed;
     everything else on the page stays on the month. */
  var query = '';

  /* ---------- helpers ---------- */

  function byId(id) { return document.getElementById(id); }

  function summaryLabel(monthKey) {
    if (monthKey === data.currentMonth()) return 'This month you have spent';
    if (monthKey === data.previousMonth()) return 'Last month you spent';
    return 'In ' + data.monthLabel(monthKey) + ' you spent';
  }

  function greeting() {
    var hour = new Date().getHours();
    if (hour < 5) return 'Still up';
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  /* Anything the server refuses, said in one line. */
  function fail(what, error) {
    var hint = data.setupHint(error);
    if (hint) return ui.toast(hint, { duration: 20000 });

    var detail = error && error.message ? error.message : 'Please try again.';
    ui.toast(what + ' ' + detail, { duration: 8000 });
  }

  /* ---------- render ---------- */

  /* Which currency the chart and the three stat tiles are about. A month with
     one currency has no choice to make; a mixed one starts on whichever was
     spent most and remembers the pick while the choice still exists. */
  var focusCurrency = null;

  function focusPart(stats) {
    if (!stats.parts.length) return null;
    for (var i = 0; i < stats.parts.length; i++) {
      if (stats.parts[i].currency === focusCurrency) return stats.parts[i];
    }
    focusCurrency = stats.parts[0].currency;
    return stats.parts[0];
  }

  function render() {
    var stats = data.statsFor(viewMonth);
    var previous = data.statsFor(data.shiftMonth(viewMonth, -1));
    var part = focusPart(stats);

    renderSummary(stats, previous);
    renderMonthNav();
    renderStats(stats, part);
    renderTrend();
    renderBreakdown(stats, part);
    renderSearchBox();

    if (query) renderMatches();
    else renderTransactions(stats);
  }

  /* One line per currency, biggest spend first. Nothing is added across them:
     800 lei and 20 dollars are two facts, not one sum. */
  function renderSummary(stats, previous) {
    dom.summaryLabel.textContent = summaryLabel(viewMonth);

    if (!stats.parts.length) {
      dom.summaryValue.innerHTML = '<span class="summary__amount">' +
        ui.escapeHtml(ui.money(0)) + '</span>';
    } else {
      dom.summaryValue.innerHTML = stats.parts.map(function (part, index) {
        return '<span class="summary__amount' +
          (index ? ' summary__amount--more' : '') + '">' +
          ui.escapeHtml(ui.money(part.total, part.currency)) + '</span>';
      }).join('');
    }

    renderDelta(stats, previous);
  }

  /* The comparison only works like for like, so it follows the currency the
     rest of the page is showing and compares it to the same one last month. */
  function renderDelta(stats, previous) {
    var previousName = data.monthLabelRelative(previous.month).toLowerCase();
    var currency = focusCurrency;
    var now = (stats.byCurrency[currency] || {}).total || 0;
    var before = (previous.byCurrency[currency] || {}).total || 0;
    var delta = Math.round((now - before) * 100) / 100;

    function plain(text) {
      dom.summaryDelta.textContent = text;
      dom.summaryDelta.removeAttribute('data-dir');
    }

    if (previous.count === 0 && stats.count === 0) return plain('Nothing logged yet.');
    if (!currency || !previous.byCurrency[currency]) {
      return plain('Nothing to compare — ' + previousName + ' has nothing in ' +
        (currency || 'this currency') + '.');
    }
    if (delta === 0) return plain('Exactly the same as ' + previousName + '.');

    dom.summaryDelta.dataset.dir = delta > 0 ? 'up' : 'down';
    dom.summaryDelta.innerHTML = (delta > 0 ? '&uarr; ' : '&darr; ') +
      ui.escapeHtml(ui.money(Math.abs(delta), currency)) +
      (delta > 0 ? ' more' : ' less') +
      ' <small>than ' + ui.escapeHtml(previousName) + '</small>';
  }

  function renderMonthNav() {
    dom.monthLabel.textContent = data.monthLabelRelative(viewMonth);
    dom.monthLabel.title = data.monthLabel(viewMonth);
    dom.monthNext.disabled = viewMonth >= data.currentMonth();
    dom.monthPrev.disabled = viewMonth <= data.floorMonth();
  }

  /* The count covers the whole month; the two money tiles cannot, so they say
     which currency they are about. */
  function renderStats(stats, part) {
    dom.statCount.textContent = stats.count;

    if (!part) {
      dom.statPerDay.textContent = '—';
      dom.statBiggest.textContent = '—';
      dom.statBiggestNote.textContent = 'no expenses yet';
      return;
    }

    dom.statPerDay.textContent = ui.money(part.perDay, part.currency);
    dom.statBiggest.textContent = part.biggest
      ? ui.money(part.biggest.amount, part.currency)
      : '—';
    dom.statBiggestNote.textContent = part.biggest
      ? data.categoryById(part.biggest.category).label
      : 'no expenses yet';
  }

  /* A row of buttons, one per currency, shown only when the month holds more
     than one. Percentages inside a single currency mean something; across two
     they would not, which is the whole reason this control exists. */
  function renderCurrencyPicker(stats) {
    var many = stats.parts.length > 1;
    dom.currencyPicker.classList.toggle('hidden', !many);
    if (!many) { dom.currencyPicker.innerHTML = ''; return; }

    dom.currencyPicker.innerHTML = stats.parts.map(function (part) {
      var on = part.currency === focusCurrency;
      return '<button class="seg" type="button" data-currency="' +
        ui.escapeHtml(part.currency) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        ui.escapeHtml(part.currency) + '</button>';
    }).join('');
  }

  /* ---------- month by month ----------

     One series, so there is no legend to read: the card title names it. The
     month you are looking at is marked twice over — the darkest green in the
     scale and a filled label — because the step below it sits too close to
     the others to be told apart by anyone, let alone by someone colour-blind.
     Every bar carries its month and its amount in its own label, so none of
     this depends on reading a colour at all. */

  /* Twelve bars need room for twelve labels underneath. A phone has room for
     six, and six months still answer the question. */
  function monthsOnChart() {
    return window.matchMedia && window.matchMedia('(max-width: 680px)').matches ? 6 : 12;
  }

  /* The run ends at this month — or earlier, by just enough to keep the month
     being viewed on the chart, so stepping back never walks off it. */
  function trendWindow() {
    var count = monthsOnChart();
    var end = data.currentMonth();
    var reach = data.shiftMonth(viewMonth, count - 1);
    return data.recentMonths(reach < end ? reach : end, count);
  }

  /* Which currency the chart is about. Its own pick, not the one the month
     cards use: this window is wider than any single month. */
  var trendCurrency = null;

  function renderTrend() {
    var months = trendWindow();
    var live = months.filter(function (month) { return month.totals.length > 0; });

    /* One month is not a trend, and a chart of one bar says nothing. */
    if (live.length < 2) {
      dom.trendCard.classList.add('hidden');
      return;
    }
    dom.trendCard.classList.remove('hidden');

    /* Every currency that turns up anywhere in the window, most spent first. */
    var sums = {};
    var order = [];
    months.forEach(function (month) {
      month.totals.forEach(function (row) {
        if (!(row.currency in sums)) { sums[row.currency] = 0; order.push(row.currency); }
        sums[row.currency] += row.total;
      });
    });
    order.sort(function (a, b) { return sums[b] - sums[a]; });
    if (order.indexOf(trendCurrency) === -1) trendCurrency = order[0];

    var many = order.length > 1;
    dom.trendCurrency.classList.toggle('hidden', !many);
    dom.trendCurrency.innerHTML = many ? order.map(function (currency) {
      return '<button class="seg" type="button" data-trend-currency="' +
        ui.escapeHtml(currency) + '" aria-pressed="' +
        (currency === trendCurrency ? 'true' : 'false') + '">' +
        ui.escapeHtml(currency) + '</button>';
    }).join('') : '';

    /* "May – Oct 2026" rather than the year twice over; the year is only
       written on both ends when they really are two different years. */
    var first = months[0].month;
    var last = months[months.length - 1].month;
    dom.trendHint.textContent = first.slice(0, 4) === last.slice(0, 4)
      ? data.monthLabel(first).slice(0, 3) + ' – ' + data.monthLabel(last).slice(0, 3) +
        ' ' + last.slice(0, 4)
      : data.monthLabel(first).slice(0, 3) + ' ' + first.slice(0, 4) + ' – ' +
        data.monthLabel(last).slice(0, 3) + ' ' + last.slice(0, 4);

    /* A narrow chart has no room under a bar for "May '26", and no need: six
       months cannot hold the same month name twice, and the line above spells
       the range out in full either way. */
    var years = months.length > 6;

    var values = months.map(function (month) {
      return month.byCurrency[trendCurrency] || 0;
    });
    var tallest = Math.max.apply(null, values);

    /* Averaged over the months that have something in them. A month with no
       lei in it is almost always a month you spent no lei, not a cheap one,
       and counting it would drag the line down to nothing. */
    var spent = values.filter(function (value) { return value > 0; });
    var average = spent.reduce(function (sum, value) { return sum + value; }, 0) / spent.length;

    dom.trendPlot.innerHTML =
      '<div class="trend__bars">' +
        months.map(function (month, i) {
          return renderBar(month, values[i], tallest,
            i > 0 ? months[i - 1].month : null, years);
        }).join('') +
      '</div>' +
      '<div class="trend__avg" style="--at: ' +
        (tallest > 0 ? 1 - average / tallest : 1).toFixed(4) + '">' +
        '<span class="trend__avg-label">avg ' +
          ui.escapeHtml(ui.moneyShort(average, trendCurrency)) + '</span>' +
      '</div>';

    ui.bindTips(dom.trendPlot);
  }

  function renderBar(month, value, tallest, before, years) {
    var here = month.month === viewMonth;
    var label = data.monthLabel(month.month);
    var written = ui.money(value, trendCurrency);

    /* Just the month, except where the year turns over — and on the first bar,
       which has no earlier one to have said it. */
    var tick = label.slice(0, 3);
    if (years && (!before || before.slice(0, 4) !== month.month.slice(0, 4))) {
      tick += ' ’' + month.month.slice(2, 4);
    }

    return '<button class="trend__bar" type="button" data-month="' +
      ui.escapeHtml(month.month) + '"' + (here ? ' aria-current="true"' : '') +
      ' style="--h: ' + (tallest > 0 ? (value / tallest) * 100 : 0).toFixed(2) + '"' +
      ' data-tip="' + ui.escapeHtml(label + ' · ' + written) + '"' +
      ' aria-label="' + ui.escapeHtml(label + ', ' + written +
        (here ? ', the month shown above' : ', show this month')) + '">' +
      '<span class="trend__col"><span class="trend__fill"></span></span>' +
      '<span class="trend__tick">' + ui.escapeHtml(tick) + '</span>' +
    '</button>';
  }

  function renderBreakdown(stats, part) {
    renderCurrencyPicker(stats);

    var byCategory = part ? part.byCategory : [];
    var hasData = byCategory.length > 0;
    dom.breakdownEmpty.classList.toggle('hidden', hasData);
    dom.shareBar.classList.toggle('hidden', !hasData);
    dom.breakdown.classList.toggle('hidden', !hasData);
    dom.breakdownHint.textContent = hasData
      ? byCategory.length + (byCategory.length === 1 ? ' category' : ' categories')
      : '';

    if (!hasData) {
      dom.shareBar.innerHTML = '';
      dom.breakdown.innerHTML = '';
      return;
    }

    var money = function (value) { return ui.money(value, part.currency); };

    /* Always one decimal, so a column of them lines up on the point; a slice
       too thin to earn even a tenth says so rather than printing '0.0%'. */
    var share = function (row) {
      return row.shown === 0 ? '<0.1%' : row.shown.toFixed(1) + '%';
    };

    /* Share bar — segments stay in the palette's validated order. */
    dom.shareBar.innerHTML = byCategory.map(function (row) {
      return '<div class="share-bar__seg" tabindex="0" role="img"' +
        ' style="--dot: ' + row.category.color + '; flex: ' + row.percent.toFixed(4) + '"' +
        ' data-tip="' + ui.escapeHtml(row.category.label + ' · ' + money(row.total) +
          ' · ' + share(row)) + '"' +
        ' aria-label="' + ui.escapeHtml(row.category.label + ', ' + money(row.total) +
          ', ' + share(row)) + '"></div>';
    }).join('');

    /* Written breakdown, biggest first. Every bar carries its own name, amount
       and share, so nothing here depends on telling two colours apart. */
    var rows = byCategory.slice().sort(function (a, b) { return b.total - a.total; });

    dom.breakdown.innerHTML = rows.map(function (row) {
      return '<li class="breakdown__row" style="--dot: ' + row.category.color + '">' +
        '<div class="breakdown__head">' +
          '<span class="breakdown__dot" aria-hidden="true"></span>' +
          '<span class="breakdown__name">' + ui.escapeHtml(row.category.label) + '</span>' +
          '<span class="breakdown__amount">' + ui.escapeHtml(money(row.total)) + '</span>' +
          '<span class="breakdown__pct">' + ui.escapeHtml(share(row)) + '</span>' +
        '</div>' +
        '<div class="breakdown__track">' +
          '<div class="breakdown__fill" style="width: ' + row.percent.toFixed(2) + '%"></div>' +
        '</div>' +
      '</li>';
    }).join('');

    ui.bindTips(dom.shareBar);
  }

  function renderTransactions(stats) {
    var hasData = stats.count > 0;
    dom.txNoMatch.classList.add('hidden');
    dom.searchSum.classList.add('hidden');
    dom.txEmpty.classList.toggle('hidden', hasData);
    dom.txScroll.classList.toggle('hidden', !hasData);
    dom.txHint.textContent = hasData
      ? stats.count + (stats.count === 1 ? ' expense' : ' expenses')
      : '';

    /* The sample-data shortcut only makes sense while the account is empty. */
    dom.seedBtn.classList.toggle('hidden', data.all().length > 0);

    if (!hasData) {
      dom.txGroups.innerHTML = '';
      return;
    }

    dom.txGroups.innerHTML = renderDays(stats.transactions);
  }

  /* The list itself, a heading per day. Used for a month and for a set of
     search results alike — both arrive already sorted newest first. */
  function renderDays(list) {
    var groups = [];
    var index = {};

    list.forEach(function (tx) {
      if (!index[tx.date]) {
        index[tx.date] = { date: tx.date, items: [] };
        groups.push(index[tx.date]);
      }
      index[tx.date].items.push(tx);
    });

    return groups.map(function (group) {
      return '<div class="tx-group">' +
        '<h3 class="tx-day">' + ui.escapeHtml(data.dayLabel(group.date)) + '</h3>' +
        '<ul class="tx-list">' + group.items.map(renderTx).join('') + '</ul>' +
      '</div>';
    }).join('');
  }

  /* The box only earns its place once there is something to search. */
  function renderSearchBox() {
    dom.searchRow.classList.toggle('hidden', data.all().length === 0);
    dom.searchClear.classList.toggle('hidden', !query);
  }

  /* Search results, from every month. The month's own empty state is kept out
     of the way: "no expenses this month" is not the answer to a search. */
  function renderMatches() {
    var matches = data.search(query);
    var found = matches.length > 0;

    dom.txEmpty.classList.add('hidden');
    dom.seedBtn.classList.add('hidden');
    dom.txNoMatch.classList.toggle('hidden', found);
    dom.txScroll.classList.toggle('hidden', !found);

    dom.txHint.textContent = found
      ? matches.length + (matches.length === 1 ? ' match' : ' matches') + ', any month'
      : '';

    dom.searchSum.classList.toggle('hidden', !found);
    dom.searchSum.innerHTML = found
      ? '<span class="search__sum-label">Adds up to</span>' +
        data.totalsOf(matches).map(function (row) {
          return '<b>' + ui.escapeHtml(ui.money(row.total, row.currency)) + '</b>';
        }).join('<span class="search__sum-and" aria-hidden="true">+</span>')
      : '';

    dom.txGroups.innerHTML = found ? renderDays(matches) : '';
    dom.txScroll.scrollTop = 0;
  }

  function renderTx(tx) {
    var category = data.categoryById(tx.category);
    var written = ui.money(tx.amount, tx.currency);
    return '<li class="tx" style="--dot: ' + category.color + '">' +
      '<span class="tx__icon" aria-hidden="true">' + category.icon + '</span>' +
      '<span class="tx__body">' +
        '<span class="tx__cat">' + ui.escapeHtml(category.label) + '</span>' +
        /* The note is trimmed with an ellipsis when it is long, so the full
           text lives in the tooltip as well. */
        (tx.comment
          ? '<span class="tx__note" title="' + ui.escapeHtml(tx.comment) + '">' +
              ui.escapeHtml(tx.comment) + '</span>'
          : '') +
      '</span>' +
      '<span class="tx__amount">' + ui.escapeHtml(written) + '</span>' +
      '<span class="tx__tools">' +
        copyTool(tx) +
        '<button class="tx__tool" type="button" data-edit="' + ui.escapeHtml(tx.id) + '"' +
          ' aria-label="Edit ' + ui.escapeHtml(category.label + ' ' + written) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
          ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>' +
        '</button>' +
        '<button class="tx__tool tx__tool--danger" type="button" data-remove="' +
          ui.escapeHtml(tx.id) + '"' +
          ' aria-label="Delete ' + ui.escapeHtml(category.label + ' ' + written) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"' +
          ' stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>' +
      '</span>' +
    '</li>';
  }

  /* ---------- add expense ---------- */

  /* The only way an expense of yours reaches a group. Never automatic, never a
     move: it writes a second row over there and leaves this one alone. The
     button appears once there is a group to copy into, and lights up when this
     expense already has a copy somewhere — js/groupboard.js handles the click
     and offers the groups it is not in yet. */
  function copyTool(tx) {
    if (!NS.groups || !NS.groups.isLoaded() || !NS.groups.all().length) return '';

    var already = NS.groups.copiesOf(tx.id).length;

    return '<button class="tx__tool' + (already ? ' is-on' : '') + '" type="button"' +
      ' data-copy="' + ui.escapeHtml(tx.id) + '" aria-label="' +
      (already ? 'Already copied into ' + already + (already === 1 ? ' group' : ' groups') +
                 '. Copy into another one.'
               : 'Copy into a group') + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
      ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="9" y="9" width="11" height="11" rx="2.5"/>' +
      '<path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5V5.5A2.5 2.5 0 0 1 5.5 3h8A1.5 1.5 0 0 1 15 4.5V5"/>' +
      '</svg></button>';
  }

  /* "Also copy into a group", under the comment box. It is rebuilt and set
     back to nobody every time the dialog opens: putting something in front of
     other people is a decision taken each time, never one left switched on
     from last week. */
  function fillShare() {
    var box = byId('add-share');
    var select = byId('field-share');
    if (!box || !select) return;

    var mine = (NS.groups && NS.groups.isLoaded()) ? NS.groups.all() : [];

    /* Not offered while editing: a copy is made from an expense, once, and
       the copy it already made is not what this dialog is about. */
    box.classList.toggle('hidden', !mine.length || !!editing);

    select.innerHTML = '<option value="">Keep it to myself</option>' +
      mine.map(function (group) {
        return '<option value="' + ui.escapeHtml(group.id) + '">' +
          ui.escapeHtml(group.name) + '</option>';
      }).join('');
    select.value = '';
  }

  function buildCategoryPicker() {
    dom.catGrid.innerHTML = data.categoriesForPicker().map(function (cat) {
      return '<label class="cat-option" style="--dot: ' + cat.color + '">' +
        '<input type="radio" name="category" value="' + cat.id + '">' +
        '<span>' + ui.escapeHtml(cat.label) + '</span>' +
      '</label>';
    }).join('');
  }

  function setFieldError(name, message) {
    var field = dom.form.querySelector('[data-field="' + name + '"]');
    if (!field) return;
    field.classList.toggle('field--invalid', !!message);
    var slot = field.querySelector('.field__error');
    if (slot) slot.textContent = message || '';
  }

  function clearErrors() {
    ['amount', 'category', 'date', 'comment'].forEach(function (name) {
      setFieldError(name, '');
    });
  }

  function updateCommentCount() {
    var used = dom.fieldComment.value.length;
    var limit = data.MAX_COMMENT;
    dom.commentCount.textContent = used + ' / ' + limit;
    dom.commentCount.dataset.state = used >= limit ? 'full'
      : (used >= limit - 20 ? 'near' : '');
  }

  function setSaving(state) {
    dom.submitBtn.disabled = state;
    dom.submitBtn.textContent = state
      ? 'Saving…'
      : (editing ? 'Save changes' : 'Add expense');
  }

  function pickCategory(id) {
    var option = dom.form.querySelector('input[name="category"][value="' + id + '"]');
    if (option) option.checked = true;
  }

  /* Called with no argument to add, or with an expense to change it. */
  function openDialog(tx) {
    editing = tx ? tx.id : null;

    clearErrors();
    dom.form.reset();
    updateCommentCount();

    dom.title.textContent = editing ? 'Edit expense' : 'Add expense';
    dom.subtitle.textContent = editing
      ? 'The same expense is updated, and it keeps the currency it was logged in.'
      : 'Any day up to today — older months are fine.';

    /* An expense is logged in one currency and stays there, so the sign in
       front of the field is the one this particular expense uses. */
    ui.showSymbol(editing ? tx.currency : ui.currencyCode());

    dom.fieldDate.max = data.today();

    if (editing) {
      dom.fieldAmount.value = tx.amount;
      pickCategory(tx.category);
      dom.fieldDate.value = tx.date;
      dom.fieldComment.value = tx.comment || '';
      updateCommentCount();
    } else {
      dom.fieldDate.value = viewMonth === data.currentMonth()
        ? data.today()
        : lastDayOf(viewMonth);
    }

    dom.fieldDate.min = data.oldestDate();

    fillShare();
    setSaving(false);

    if (typeof dom.dialog.showModal === 'function') dom.dialog.showModal();
    else dom.dialog.setAttribute('open', '');
    window.setTimeout(function () { dom.fieldAmount.focus(); }, 30);
  }

  function openEditDialog(id) {
    var tx = data.find(id);
    if (!tx) {
      ui.toast('That expense is not here any more.');
      return;
    }
    openDialog(tx);
  }

  /* While browsing an older month, pre-fill its last day rather than today —
     you are almost certainly adding something to the month you are looking at. */
  function lastDayOf(monthKey) {
    if (monthKey >= data.currentMonth()) return data.today();
    var year = parseInt(monthKey.slice(0, 4), 10);
    var month = parseInt(monthKey.slice(5, 7), 10);
    var lastDay = new Date(year, month, 0).getDate();
    return monthKey + '-' + (lastDay < 10 ? '0' : '') + lastDay;
  }

  function closeDialog() {
    if (typeof dom.dialog.close === 'function') dom.dialog.close();
    else dom.dialog.removeAttribute('open');
  }

  function submit(event) {
    event.preventDefault();
    clearErrors();
    setSaving(true);

    var checked = dom.form.querySelector('input[name="category"]:checked');
    var input = {
      amount: dom.fieldAmount.value,
      category: checked ? checked.value : '',
      date: dom.fieldDate.value,
      comment: dom.fieldComment.value
    };

    var changing = editing;

    /* Read before the dialog closes, and only honoured on a new expense. */
    var shareSelect = byId('field-share');
    var shareWith = (!changing && shareSelect) ? shareSelect.value : '';

    var write = changing ? data.update(changing, input) : data.add(input);

    write.then(function (result) {
      setSaving(false);

      if (!result.ok) {
        Object.keys(result.errors).forEach(function (name) {
          setFieldError(name, result.errors[name]);
        });
        var first = dom.form.querySelector('.field--invalid input, .field--invalid textarea');
        if (first) first.focus();
        return;
      }

      closeDialog();
      viewMonth = data.monthOf(result.tx.date);
      render();

      var label = data.categoryById(result.tx.category).label;
      var written = ui.money(result.tx.amount, result.tx.currency);
      ui.toast(changing
        ? 'Updated to ' + written + ' in ' + label + '.'
        : 'Added ' + written + ' to ' + label + '.');

      if (shareWith) shareCopy(shareWith, result.tx);
    }).catch(function (error) {
      setSaving(false);
      fail(changing ? 'Could not save that change.' : 'Could not save that expense.', error);
    });
  }

  /* The copy is written after the expense itself is safely in, and it fails on
     its own terms: if the group write is refused, the expense is still in your
     list, which is the half that matters. Saying so beats a silent half-done
     action. */
  function shareCopy(groupId, tx) {
    if (!NS.groups) return;

    NS.groups.copy(groupId, tx).then(function () {
      render();
      if (NS.groupBoard) NS.groupBoard.refresh();
      var group = NS.groups.find(groupId);
      ui.toast('Copied into ' + (group ? group.name : 'the group') + ' as well.');
    }).catch(function (error) {
      fail('Saved to your list, but the copy into the group did not go through.', error);
    });
  }

  function removeTransaction(id) {
    data.remove(id).then(function (removed) {
      if (!removed) return;
      render();
      ui.toast('Expense deleted.', {
        action: 'Undo',
        onAction: function () {
          data.restore(removed).then(function () {
            viewMonth = data.monthOf(removed.date);
            render();
          }).catch(function (error) {
            fail('Could not bring that expense back.', error);
          });
        }
      });
    }).catch(function (error) {
      fail('Could not delete that expense.', error);
    });
  }

  /* ---------- expenses left in this browser by the old version ---------- */

  function offerLegacyImport() {
    var pending = data.legacyExpenses();
    if (!pending.length) return;

    ui.toast(pending.length + ' expense' + (pending.length === 1 ? '' : 's') +
      ' from before you had an account are still in this browser.', {
      action: 'Import',
      duration: 20000,
      onAction: function () {
        data.importLegacy().then(function (added) {
          data.forgetLegacy();
          render();
          ui.toast('Imported ' + added.length +
            (added.length === 1 ? ' expense' : ' expenses') + ' into your account.');
        }).catch(function (error) {
          fail('Could not import them.', error);
        });
      }
    });
  }

  /* ---------- wiring ---------- */

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-open-add]'), function (btn) {
      btn.addEventListener('click', function () { openDialog(); });
    });

    dom.monthPrev.addEventListener('click', function () {
      viewMonth = data.shiftMonth(viewMonth, -1);
      render();
    });

    dom.monthNext.addEventListener('click', function () {
      viewMonth = data.shiftMonth(viewMonth, 1);
      render();
    });

    dom.form.addEventListener('submit', submit);
    dom.fieldComment.addEventListener('input', updateCommentCount);

    Array.prototype.forEach.call(document.querySelectorAll('[data-close-dialog]'), function (btn) {
      btn.addEventListener('click', closeDialog);
    });

    /* Clicking the dim area outside the card closes the dialog. */
    dom.dialog.addEventListener('click', function (event) {
      if (event.target === dom.dialog) closeDialog();
    });

    /* One listener for the whole list, so rows redrawn on every render do not
       each need wiring up again. */
    dom.txGroups.addEventListener('click', function (event) {
      var remove = event.target.closest('[data-remove]');
      if (remove) { removeTransaction(remove.dataset.remove); return; }

      var edit = event.target.closest('[data-edit]');
      if (edit) openEditDialog(edit.dataset.edit);
    });

    dom.searchField.addEventListener('input', function () {
      query = dom.searchField.value.trim();
      render();
    });

    /* Escape is the shortcut people already expect from a search box. */
    dom.searchField.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && query) { event.preventDefault(); clearSearch(); }
    });

    dom.searchClear.addEventListener('click', clearSearch);

    /* A bar is a way into its month. */
    dom.trendPlot.addEventListener('click', function (event) {
      var bar = event.target.closest('[data-month]');
      if (!bar) return;
      viewMonth = bar.dataset.month;
      ui.hideTip();
      render();
    });

    dom.trendCurrency.addEventListener('click', function (event) {
      var button = event.target.closest('[data-trend-currency]');
      if (!button) return;
      trendCurrency = button.dataset.trendCurrency;
      render();
    });

    /* Crossing the phone/desktop line changes how many months fit, so the
       chart is drawn again rather than left at the old count. */
    if (window.matchMedia) {
      var narrow = window.matchMedia('(max-width: 680px)');
      var redraw = function () { render(); };
      if (narrow.addEventListener) narrow.addEventListener('change', redraw);
      else if (narrow.addListener) narrow.addListener(redraw);
    }

    /* Switching which currency the chart and the tiles are about. */
    dom.currencyPicker.addEventListener('click', function (event) {
      var button = event.target.closest('[data-currency]');
      if (!button) return;
      focusCurrency = button.dataset.currency;
      render();
    });

    dom.seedBtn.addEventListener('click', function () {
      dom.seedBtn.disabled = true;
      data.seedSample().then(function () {
        viewMonth = data.currentMonth();
        render();
        ui.toast('Sample expenses added. Delete any of them whenever you like.');
      }).catch(function (error) {
        dom.seedBtn.disabled = false;
        fail('Could not add the sample data.', error);
      });
    });

    window.addEventListener('scroll', ui.hideTip, { passive: true });
  }

  function clearSearch() {
    query = '';
    dom.searchField.value = '';
    dom.searchField.focus();
    render();
  }

  /* Fetched alongside the expenses, so the copy buttons and the count on the
     Groups tab are right on the first paint rather than appearing a moment
     later. A refusal here is not fatal: a database that has not had the groups
     migration run still gets a working personal dashboard, with an empty tab
     beside it. */
  function loadGroups() {
    if (!NS.groups) return Promise.resolve(false);
    return NS.groups.load().catch(function (error) {
      if (window.console) {
        window.console.warn('Groups are not available: ' + (error && error.message));
      }
      return false;
    });
  }

  /* The same bargain for friends: a database without the friends migration
     leaves an empty tab, not a broken dashboard. */
  function loadFriends() {
    if (!NS.friends) return Promise.resolve(false);
    return NS.friends.load().catch(function (error) {
      if (window.console) {
        window.console.warn('Friends are not available: ' + (error && error.message));
      }
      return false;
    });
  }

  function init() {
    dom = {
      greeting: byId('greeting'),
      summaryLabel: byId('summary-label'),
      summaryValue: byId('summary-value'),
      summaryDelta: byId('summary-delta'),
      monthLabel: byId('month-label'),
      monthPrev: byId('month-prev'),
      monthNext: byId('month-next'),
      statCount: byId('stat-count'),
      statPerDay: byId('stat-per-day'),
      statBiggest: byId('stat-biggest'),
      statBiggestNote: byId('stat-biggest-note'),
      shareBar: byId('share-bar'),
      breakdown: byId('breakdown'),
      breakdownEmpty: byId('breakdown-empty'),
      breakdownHint: byId('breakdown-hint'),
      trendCard: byId('trend-card'),
      trendHint: byId('trend-hint'),
      trendCurrency: byId('trend-currency'),
      trendPlot: byId('trend-plot'),
      searchRow: byId('tx-search-row'),
      searchField: byId('tx-search'),
      searchClear: byId('tx-search-clear'),
      searchSum: byId('tx-search-sum'),
      txNoMatch: byId('tx-nomatch'),
      txScroll: byId('tx-scroll'),
      txGroups: byId('tx-groups'),
      txEmpty: byId('tx-empty'),
      txHint: byId('tx-hint'),
      seedBtn: byId('seed-sample'),
      currencyPicker: byId('breakdown-currency'),
      dialog: byId('add-dialog'),
      title: byId('add-title'),
      subtitle: byId('add-subtitle'),
      form: byId('add-form'),
      submitBtn: byId('add-submit'),
      catGrid: byId('category-grid'),
      fieldAmount: byId('field-amount'),
      fieldDate: byId('field-date'),
      fieldComment: byId('field-comment'),
      commentCount: byId('comment-count')
    };

    /* The page stays hidden until we know who this is — no flash of someone
       else's dashboard, no flash of an empty one. */
    session.require()
      .then(function (signedIn) {
        if (!signedIn) return null;
        user = signedIn;

        /* A first sign-in has no profile behind it: no username, so nobody can
           invite them anywhere, and no name, so a group would have nothing to
           call them. That is asked once, on welcome.html, and never again. */
        return NS.profile.requireSetup();
      })
      .then(function (setUp) {
        if (!setUp) return null;
        ui.mountHeader({ page: 'dashboard' });
        ui.year();
        /* The bell fetches its own rows and does not hold anything else up:
           a bell that fails to load is an empty bell, not a broken page. */
        NS.notifications.start();
        buildCategoryPicker();
        wire();
        /* The name is on the profile, not on the account object require()
           hands back — reading it off the latter greeted everyone as
           'undefined'. */
        dom.greeting.textContent = greeting() + ', ' + session.get().name + '.';
        return Promise.all([data.load(), loadGroups(), loadFriends()]);
      })
      .then(function (loaded) {
        if (!loaded) return;
        document.body.classList.remove('booting');
        render();
        if (NS.groupBoard) NS.groupBoard.start();
        if (NS.friendBoard) NS.friendBoard.start();
        offerLegacyImport();
      })
      .catch(function (error) {
        document.body.classList.remove('booting');
        fail('Could not load your expenses.', error);
      });
  }

  /* js/groupboard.js asks for a repaint after it copies something across, so
     the little mark on the expense appears straight away. */
  NS.dashboard = { refresh: render };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.MyMon);
