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
      dom.save.disabled = false;
      dom.save.textContent = 'Save';
      ui.mountHeader({ page: 'settings' });
      renderHint();
      ui.toast(first || last ? 'Saved. Hello, ' + user.name + '.' : 'Back to your Google name.');
    }).catch(function (error) {
      dom.save.disabled = false;
      dom.save.textContent = 'Save';
      ui.toast('Could not save that. ' +
        (error && error.message ? error.message : 'Please try again.'), { duration: 8000 });
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
      since: byId('account-since')
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

        var signOut = byId('sign-out');
        if (signOut) {
          signOut.addEventListener('click', function () {
            signOut.disabled = true;
            session.signOut().then(function () {
              window.location.href = 'index.html?signedout=1';
            });
          });
        }

        renderHint();
        return data.load();
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
        ui.toast('Could not read your expenses. ' +
          (error && error.message ? error.message : ''), { duration: 8000 });
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.MyMon);
