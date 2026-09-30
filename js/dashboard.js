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
    var detail = error && error.message ? error.message : 'Please try again.';
    ui.toast(what + ' ' + detail, { duration: 8000 });
  }

  /* ---------- render ---------- */

  function render() {
    var stats = data.statsFor(viewMonth);
    var previous = data.statsFor(data.shiftMonth(viewMonth, -1));

    renderSummary(stats, previous);
    renderMonthNav();
    renderStats(stats);
    renderBreakdown(stats);
    renderTransactions(stats);
  }

  function renderSummary(stats, previous) {
    dom.summaryLabel.textContent = summaryLabel(viewMonth);
    dom.summaryValue.textContent = ui.money(stats.total);

    var delta = Math.round((stats.total - previous.total) * 100) / 100;
    var previousName = data.monthLabelRelative(previous.month).toLowerCase();

    if (previous.count === 0 && stats.count === 0) {
      dom.summaryDelta.textContent = 'Nothing logged yet.';
      dom.summaryDelta.removeAttribute('data-dir');
    } else if (previous.count === 0) {
      dom.summaryDelta.textContent = 'Nothing to compare — ' + previousName + ' is empty.';
      dom.summaryDelta.removeAttribute('data-dir');
    } else if (delta === 0) {
      dom.summaryDelta.textContent = 'Exactly the same as ' + previousName + '.';
      dom.summaryDelta.removeAttribute('data-dir');
    } else {
      dom.summaryDelta.dataset.dir = delta > 0 ? 'up' : 'down';
      dom.summaryDelta.innerHTML = (delta > 0 ? '&uarr; ' : '&darr; ') +
        ui.escapeHtml(ui.money(Math.abs(delta))) +
        (delta > 0 ? ' more' : ' less') +
        ' <small>than ' + ui.escapeHtml(previousName) + '</small>';
    }
  }

  function renderMonthNav() {
    dom.monthLabel.textContent = data.monthLabelRelative(viewMonth);
    dom.monthLabel.title = data.monthLabel(viewMonth);
    dom.monthNext.disabled = viewMonth >= data.currentMonth();
    dom.monthPrev.disabled = viewMonth <= data.floorMonth();
  }

  function renderStats(stats) {
    dom.statCount.textContent = stats.count;
    dom.statPerDay.textContent = stats.count ? ui.money(stats.perDay) : '—';
    dom.statBiggest.textContent = stats.biggest ? ui.money(stats.biggest.amount) : '—';
    dom.statBiggestNote.textContent = stats.biggest
      ? data.categoryById(stats.biggest.category).label
      : 'no expenses yet';
  }

  function renderBreakdown(stats) {
    var hasData = stats.byCategory.length > 0;
    dom.breakdownEmpty.classList.toggle('hidden', hasData);
    dom.shareBar.classList.toggle('hidden', !hasData);
    dom.breakdown.classList.toggle('hidden', !hasData);
    dom.breakdownHint.textContent = hasData
      ? stats.byCategory.length + (stats.byCategory.length === 1 ? ' category' : ' categories')
      : '';

    if (!hasData) {
      dom.shareBar.innerHTML = '';
      dom.breakdown.innerHTML = '';
      return;
    }

    /* Share bar — segments stay in the palette's validated order. */
    dom.shareBar.innerHTML = stats.byCategory.map(function (row) {
      return '<div class="share-bar__seg" tabindex="0" role="img"' +
        ' style="--dot: ' + row.category.color + '; flex: ' + row.percent.toFixed(4) + '"' +
        ' data-tip="' + ui.escapeHtml(row.category.label + ' · ' + ui.money(row.total) +
          ' · ' + ui.percent(row.percent)) + '"' +
        ' aria-label="' + ui.escapeHtml(row.category.label + ', ' + ui.money(row.total) +
          ', ' + ui.percent(row.percent)) + '"></div>';
    }).join('');

    /* Written breakdown, biggest first. Every bar carries its own name, amount
       and share, so nothing here depends on telling two colours apart. */
    var rows = stats.byCategory.slice().sort(function (a, b) { return b.total - a.total; });

    dom.breakdown.innerHTML = rows.map(function (row) {
      return '<li class="breakdown__row" style="--dot: ' + row.category.color + '">' +
        '<div class="breakdown__head">' +
          '<span class="breakdown__dot" aria-hidden="true"></span>' +
          '<span class="breakdown__name">' + ui.escapeHtml(row.category.label) + '</span>' +
          '<span class="breakdown__amount">' + ui.escapeHtml(ui.money(row.total)) + '</span>' +
          '<span class="breakdown__pct">' + ui.escapeHtml(ui.percent(row.percent)) + '</span>' +
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
    dom.txEmpty.classList.toggle('hidden', hasData);
    dom.txGroups.classList.toggle('hidden', !hasData);
    dom.txHint.textContent = hasData
      ? stats.count + (stats.count === 1 ? ' expense' : ' expenses')
      : '';

    /* The sample-data shortcut only makes sense while the account is empty. */
    dom.seedBtn.classList.toggle('hidden', data.all().length > 0);

    if (!hasData) {
      dom.txGroups.innerHTML = '';
      return;
    }

    var groups = [];
    var index = {};
    stats.transactions.forEach(function (tx) {
      if (!index[tx.date]) {
        index[tx.date] = { date: tx.date, items: [] };
        groups.push(index[tx.date]);
      }
      index[tx.date].items.push(tx);
    });

    dom.txGroups.innerHTML = groups.map(function (group) {
      return '<div class="tx-group">' +
        '<h3 class="tx-day">' + ui.escapeHtml(data.dayLabel(group.date)) + '</h3>' +
        '<ul class="tx-list">' + group.items.map(renderTx).join('') + '</ul>' +
      '</div>';
    }).join('');
  }

  function renderTx(tx) {
    var category = data.categoryById(tx.category);
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
      '<span class="tx__amount">' + ui.escapeHtml(ui.money(tx.amount)) + '</span>' +
      '<span class="tx__tools">' +
        '<button class="tx__tool" type="button" data-edit="' + ui.escapeHtml(tx.id) + '"' +
          ' aria-label="Edit ' + ui.escapeHtml(category.label + ' ' + ui.money(tx.amount)) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
          ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>' +
        '</button>' +
        '<button class="tx__tool tx__tool--danger" type="button" data-remove="' +
          ui.escapeHtml(tx.id) + '"' +
          ' aria-label="Delete ' + ui.escapeHtml(category.label + ' ' + ui.money(tx.amount)) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"' +
          ' stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>' +
      '</span>' +
    '</li>';
  }

  /* ---------- add expense ---------- */

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
      ? 'Change anything here and the same expense is updated.'
      : 'This month or last month, nothing in the future.';

    dom.fieldDate.max = data.today();

    if (editing) {
      dom.fieldAmount.value = tx.amount;
      pickCategory(tx.category);
      dom.fieldDate.value = tx.date;
      dom.fieldComment.value = tx.comment || '';
      updateCommentCount();

      /* An expense older than the usual window keeps its own date as a valid
         choice — editing the comment must not force the date to move. */
      var floor = data.previousMonth() + '-01';
      dom.fieldDate.min = tx.date < floor ? tx.date : floor;
    } else {
      dom.fieldDate.min = data.previousMonth() + '-01';
      dom.fieldDate.value = viewMonth === data.currentMonth()
        ? data.today()
        : lastLoggableDayOf(viewMonth);
    }

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

  /* When browsing last month, pre-fill its last day rather than today's date. */
  function lastLoggableDayOf(monthKey) {
    if (monthKey !== data.previousMonth()) return data.today();
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
      ui.toast(changing
        ? 'Updated to ' + ui.money(result.tx.amount) + ' in ' + label + '.'
        : 'Added ' + ui.money(result.tx.amount) + ' to ' + label + '.');
    }).catch(function (error) {
      setSaving(false);
      fail(changing ? 'Could not save that change.' : 'Could not save that expense.', error);
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

    var signOut = byId('sign-out');
    if (signOut) {
      signOut.addEventListener('click', function () {
        signOut.disabled = true;
        session.signOut().then(function () {
          /* The landing page says so out loud, otherwise signing out feels
             like nothing happened. */
          window.location.href = 'index.html?signedout=1';
        });
      });
    }

    window.addEventListener('scroll', ui.hideTip, { passive: true });
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
      txGroups: byId('tx-groups'),
      txEmpty: byId('tx-empty'),
      txHint: byId('tx-hint'),
      seedBtn: byId('seed-sample'),
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
        ui.mountHeader({ page: 'dashboard' });
        ui.year();
        buildCategoryPicker();
        wire();
        dom.greeting.textContent = greeting() + ', ' + user.name + '.';
        return data.load();
      })
      .then(function (loaded) {
        if (!loaded) return;
        document.body.classList.remove('booting');
        render();
        offerLegacyImport();
      })
      .catch(function (error) {
        document.body.classList.remove('booting');
        fail('Could not load your expenses.', error);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.MyMon);
