/* MyMon — settings.
   Small page, one job: let someone choose the name MyMon greets them with.
   The name is stored on the account, so it follows them to any device. */
(function (NS) {
  'use strict';

  var data = NS.data;
  var ui = NS.ui;
  var session = NS.session;

  var user = null;
  var dom = {};

  function byId(id) { return document.getElementById(id); }

  function setFieldError(name, message) {
    var field = document.querySelector('[data-field="' + name + '"]');
    if (!field) return;
    field.classList.toggle('field--invalid', !!message);
    var slot = field.querySelector('.field__error');
    if (slot) slot.textContent = message || '';
  }

  function clearErrors() {
    setFieldError('first', '');
    setFieldError('last', '');
  }

  /* Says which name is in use and where it came from. */
  function renderHint() {
    var chosen = (dom.first.value.trim() + ' ' + dom.last.value.trim()).trim();

    if (chosen) {
      dom.hint.textContent = 'MyMon will greet you as “' + chosen + '”.';
    } else if (user.googleName) {
      dom.hint.textContent = 'Leave both empty and MyMon uses your Google name, “' +
        user.googleName + '”.';
    } else {
      dom.hint.textContent = 'Leave both empty and MyMon uses the first part of your email.';
    }

    dom.reset.classList.toggle('hidden', !(user.firstName || user.lastName));
  }

  function renderAccount() {
    dom.email.textContent = user.email || '—';

    var all = data.all();
    dom.count.textContent = all.length
      ? all.length + (all.length === 1 ? ' expense' : ' expenses')
      : 'none yet';

    if (all.length) {
      var oldest = all[all.length - 1];      /* the list is newest first */
      dom.since.textContent = data.monthLabel(data.monthOf(oldest.date));
    } else {
      dom.since.textContent = '—';
    }

    dom.exportSheet.disabled = all.length === 0;
    dom.exportCsv.disabled = all.length === 0;
  }

  /* Hands the browser a file the page made itself — no server, no upload,
     nothing leaves the machine except into the downloads folder. */
  function saveFile(blob, name, said) {
    var url = URL.createObjectURL(blob);

    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.parentNode.removeChild(link);

    /* Letting go of the blob once the download has had a moment to start. */
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 2000);

    ui.toast(said);
  }

  function howMany(n) {
    return n + (n === 1 ? ' expense' : ' expenses') + ' saved to your downloads.';
  }

  /* A real spreadsheet. A .csv has no columns, only commas, and whether those
     become columns is up to whichever program opens it and which country it
     thinks it is in; this one carries its columns, their widths and the types
     of what is in them. */
  function downloadSheet() {
    var all = data.all();
    if (!all.length) { ui.toast('There is nothing to download yet.'); return; }

    var bytes = NS.xlsx.book(data.toSheet());
    saveFile(new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }), 'mymon-' + data.today() + '.xlsx', howMany(all.length));
  }

  /* The same table as plain text, for anything that would rather have that. */
  function downloadCsv() {
    var all = data.all();
    if (!all.length) { ui.toast('There is nothing to download yet.'); return; }

    /* The byte order mark is what makes a spreadsheet read "Benzină" rather
       than mojibake: without it Excel opens the file as the local code page,
       and every accented letter comes out wrong. */
    saveFile(new Blob(['\ufeff' + data.toCsv()], { type: 'text/csv;charset=utf-8' }),
      'mymon-' + data.today() + '.csv', howMany(all.length));
  }

  function save(event) {
    event.preventDefault();
    clearErrors();

    var first = dom.first.value.trim();
    var last = dom.last.value.trim();
    var failed = false;

    /* A last name on its own reads as a mistake rather than a choice. */
    if (!first && last) {
      setFieldError('first', 'Add a first name too, or clear both.');
      failed = true;
    }

    if (failed) {
      var focusMe = document.querySelector('.field--invalid input');
      if (focusMe) focusMe.focus();
      return;
    }

    dom.save.disabled = true;
    dom.save.textContent = 'Saving…';

    session.updateName(first, last).then(function (updated) {
      user = updated;

      /* The account has it; the groups you are in read it off the profile, so
         the second copy goes out in the same breath. If that write fails the
         name is still saved where it matters most — the toast below would be
         a lie, so the failure is reported rather than swallowed. */
      return NS.profile.saveName(first, last).then(function () { return updated; });
    }).then(function (updated) {
      dom.save.disabled = false;
      dom.save.textContent = 'Save';
      ui.mountHeader({ page: 'settings' });
      renderHint();
      ui.toast(first || last ? 'Saved. Hello, ' + updated.name + '.' : 'Back to your Google name.');
    }).catch(function (error) {
      dom.save.disabled = false;
      dom.save.textContent = 'Save';
      ui.toast('Could not save that. ' +
        (error && error.message ? error.message : 'Please try again.'), { duration: 8000 });
    });
  }

  /* ---------- currency ---------- */

  function buildCurrencyPicker() {
    dom.currency.innerHTML = ui.currencies.map(function (item) {
      return '<option value="' + item.code + '">' +
        ui.escapeHtml(item.label + ' (' + item.code + ')') + '</option>';
    }).join('');
    dom.currency.value = ui.currencyCode();
  }

  /* Shows the choice in the only way that really answers the question:
     a real amount, written the way the dashboard would write it. */
  function renderCurrencyPreview() {
    var chosen = dom.currency.value;
    var sample = new Intl.NumberFormat('en-US', {
      style: 'currency', currency: chosen,
      minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(1284.5);

    dom.currencyPreview.textContent = 'New expenses will look like ' + sample + '.';
  }

  function saveCurrency(event) {
    event.preventDefault();

    var chosen = dom.currency.value;
    dom.currencySave.disabled = true;
    dom.currencySave.textContent = 'Saving…';

    session.updateCurrency(chosen).then(function (updated) {
      user = updated;
      dom.currencySave.disabled = false;
      dom.currencySave.textContent = 'Save';

      /* onChange has already told ui to switch; the page just has to redraw
         the amounts it had written in the old one. */
      renderAccount();
      renderCurrencyPreview();
      ui.toast('New expenses will be recorded in ' + ui.currencyCode() + '.');
    }).catch(function (error) {
      dom.currencySave.disabled = false;
      dom.currencySave.textContent = 'Save';
      ui.toast('Could not save that. ' +
        (error && error.message ? error.message : 'Please try again.'), { duration: 8000 });
    });
  }

  /* ---------- username ---------- */

  var claimed = null;        /* the name already saved, if any */
  var checkTimer = null;

  function setStatus(text, state) {
    dom.userStatus.textContent = text;
    dom.userStatus.dataset.state = state || '';
  }

  /* Runs while typing, a beat after the last keystroke so the database is not
     asked once per letter. */
  function checkAvailability() {
    window.clearTimeout(checkTimer);
    setFieldError('username', '');

    var typed = dom.username.value;
    var checked = NS.profile.validate(typed);

    if (!typed.trim()) {
      setStatus(claimed
        ? 'Your username is @' + claimed + '.'
        : 'Three to twenty characters. Letters, numbers and underscores, starting with a letter.', '');
      return;
    }

    if (!checked.ok) {
      setStatus(checked.error, 'bad');
      return;
    }

    if (claimed && checked.value === claimed) {
      setStatus('This is already your username.', '');
      return;
    }

    setStatus('Checking…', '');

    checkTimer = window.setTimeout(function () {
      var asked = checked.value;
      NS.profile.isAvailable(asked)
        .then(function (free) {
          /* Ignore an answer that arrived after the person kept typing. */
          if (NS.profile.validate(dom.username.value).value !== asked) return;
          setStatus(free ? '@' + asked + ' is free.' : '@' + asked + ' is already taken.',
            free ? 'good' : 'bad');
        })
        .catch(function () {
          setStatus('Could not check that right now.', '');
        });
    }, 400);
  }

  function saveUsername(event) {
    event.preventDefault();
    window.clearTimeout(checkTimer);
    setFieldError('username', '');

    dom.userSave.disabled = true;
    dom.userSave.textContent = 'Saving…';

    NS.profile.save(dom.username.value).then(function (result) {
      dom.userSave.disabled = false;
      dom.userSave.textContent = 'Save';

      if (!result.ok) {
        setFieldError('username', result.error);
        setStatus('', '');
        return;
      }

      claimed = result.username;
      dom.username.value = claimed;
      setStatus('Your username is @' + claimed + '.', 'good');
      ui.toast('Username saved: @' + claimed);
    }).catch(function (error) {
      dom.userSave.disabled = false;
      dom.userSave.textContent = 'Save';
      ui.toast('Could not save the username. ' +
        (error && error.message ? error.message : 'Please try again.'), { duration: 8000 });
    });
  }

  function loadUsername() {
    return NS.profile.load().then(function (row) {
      claimed = row ? row.username : null;
      if (claimed) {
        dom.username.value = claimed;
        setStatus('Your username is @' + claimed + '.', 'good');
      }
    }).catch(function (error) {
      /* Most likely the profiles table has not been created yet. */
      setStatus('Usernames are not set up on this project yet.', 'bad');
      dom.userSave.disabled = true;
      if (window.console) window.console.warn('profiles:', error && error.message);
    });
  }

  function init() {
    dom = {
      first: byId('field-first'),
      last: byId('field-last'),
      hint: byId('name-hint'),
      save: byId('name-save'),
      reset: byId('name-reset'),
      form: byId('name-form'),
      email: byId('account-email'),
      count: byId('account-count'),
      exportSheet: byId('export-xlsx'),
      exportCsv: byId('export-csv'),
      since: byId('account-since'),
      username: byId('field-username'),
      userForm: byId('username-form'),
      userSave: byId('username-save'),
      userStatus: byId('username-status'),
      currency: byId('field-currency'),
      currencyForm: byId('currency-form'),
      currencySave: byId('currency-save'),
      currencyPreview: byId('currency-preview')
    };

    session.require()
      .then(function (signedIn) {
        if (!signedIn) return null;
        user = signedIn;
        ui.mountHeader({ page: 'settings' });
        ui.year();

        dom.first.value = user.firstName;
        dom.last.value = user.lastName;

        dom.form.addEventListener('submit', save);
        dom.first.addEventListener('input', renderHint);
        dom.last.addEventListener('input', renderHint);

        dom.reset.addEventListener('click', function () {
          dom.first.value = '';
          dom.last.value = '';
          renderHint();
          dom.form.dispatchEvent(new Event('submit', { cancelable: true }));
        });

        dom.exportSheet.addEventListener('click', downloadSheet);
        dom.exportCsv.addEventListener('click', downloadCsv);

        var signOut = byId('sign-out');
        if (signOut) {
          signOut.addEventListener('click', function () {
            signOut.disabled = true;
            session.signOut().then(function () {
              window.location.href = 'index.html?signedout=1';
            });
          });
        }

        buildCurrencyPicker();
        renderCurrencyPreview();
        dom.currencyForm.addEventListener('submit', saveCurrency);
        dom.currency.addEventListener('change', renderCurrencyPreview);

        dom.userForm.addEventListener('submit', saveUsername);
        dom.username.addEventListener('input', checkAvailability);

        renderHint();
        return Promise.all([data.load(), loadUsername()]);
      })
      .then(function (loaded) {
        if (!loaded) return;
        document.body.classList.remove('booting');
        renderAccount();
      })
      .catch(function (error) {
        document.body.classList.remove('booting');
        /* The name form still works even when the expenses fail to load. */
        if (user) renderAccount();
        ui.toast(data.setupHint(error) || ('Could not read your expenses. ' +
          (error && error.message ? error.message : '')), { duration: 12000 });
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.MyMon);
