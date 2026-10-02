/* MyMon — the first screen after a first sign-in.

   One short job: a name and a username, and then out of the way for good.

   Google hands over a single string for the name and no way to ask for the two
   halves separately, so this page guesses where the seam is, puts the guess in
   two fields, and lets the person fix it. That is the whole reason the page
   exists rather than a line of code splitting the name quietly and being wrong
   about everybody with two given names.

   Nobody arrives here twice: js/profile.js sends people here only while the
   profile is unfinished, and this page sends them away again the moment it is
   done. */
(function (NS) {
  'use strict';

  var ui = NS.ui;
  var session = NS.session;
  var profile = NS.profile;

  var dom = {};
  var checkTimer = null;

  function byId(id) { return document.getElementById(id); }

  function setFieldError(name, message) {
    var field = dom.form.querySelector('[data-field="' + name + '"]');
    if (!field) return;
    field.classList.toggle('field--invalid', !!message);
    var slot = field.querySelector('.field__error');
    if (slot) slot.textContent = message || '';
  }

  function clearErrors() {
    ['first', 'last', 'username'].forEach(function (name) { setFieldError(name, ''); });
  }

  function setStatus(text, state) {
    dom.status.textContent = text;
    dom.status.dataset.state = state || '';
  }

  /* ---------- the username, while it is being typed ---------------------- */

  var HINT = 'Three to twenty characters. Letters, numbers and underscores, ' +
             'starting with a letter.';

  function checkAvailability() {
    window.clearTimeout(checkTimer);
    setFieldError('username', '');

    var typed = dom.username.value;
    var checked = profile.validate(typed);

    if (!typed.trim()) return setStatus(HINT, '');
    if (!checked.ok) return setStatus(checked.error, 'bad');

    setStatus('Checking…', '');

    checkTimer = window.setTimeout(function () {
      var asked = checked.value;
      profile.isAvailable(asked)
        .then(function (free) {
          /* An answer that arrived after the person carried on typing is about
             a different name, and saying it would be worse than saying
             nothing. */
          if (profile.validate(dom.username.value).value !== asked) return;
          setStatus(free ? '@' + asked + ' is free.' : '@' + asked + ' is already taken.',
            free ? 'good' : 'bad');
        })
        .catch(function () { setStatus('Could not check that right now.', ''); });
    }, 400);
  }

  /* ---------- saving ------------------------------------------------------ */

  function submit(event) {
    event.preventDefault();
    window.clearTimeout(checkTimer);
    clearErrors();

    var first = dom.first.value.trim();
    var last = dom.last.value.trim();

    if (!first) {
      setFieldError('first', 'MyMon needs something to call you.');
      dom.first.focus();
      return;
    }

    dom.submit.disabled = true;
    dom.submit.textContent = 'Setting up…';

    profile.saveSetup(first, last, dom.username.value)
      .then(function (result) {
        if (!result.ok) {
          dom.submit.disabled = false;
          dom.submit.textContent = 'Start using MyMon';
          setFieldError(result.field || 'username', result.error);
          var again = dom.form.querySelector('.field--invalid input');
          if (again) again.focus();
          return;
        }

        /* replace, not assign: the back button should not walk them into a
           setup page they have already finished. */
        window.location.replace('dashboard.html');
      })
      .catch(function (error) {
        dom.submit.disabled = false;
        dom.submit.textContent = 'Start using MyMon';
        ui.toast('Could not save that. ' +
          (error && error.message ? error.message : 'Please try again.'),
          { duration: 8000 });
      });
  }

  /* ---------- start ------------------------------------------------------- */

  function fill(row, user) {
    /* A half-finished profile keeps whatever it already had; everything else
       starts from what Google knows. */
    var guess = profile.splitName(user.googleName || user.name || '');

    dom.first.value = (row && row.first_name) || user.firstName || guess.first || '';
    dom.last.value = (row && row.last_name) || user.lastName || guess.last || '';

    if (row && row.username) {
      dom.username.value = row.username;
      setStatus('This is already your username.', '');
      return Promise.resolve();
    }

    /* The suggestion is checked before it is shown, so nobody is handed a name
       that is already somebody else's and told so a second later. */
    return profile.suggest([dom.first.value, dom.last.value].join(' '))
      .then(function (candidate) {
        dom.username.value = candidate;
        setStatus('@' + candidate + ' is free. Change it if you would rather.', 'good');
      })
      .catch(function () { setStatus(HINT, ''); });
  }

  function init() {
    dom = {
      form: byId('welcome-form'),
      first: byId('field-first'),
      last: byId('field-last'),
      username: byId('field-username'),
      status: byId('username-status'),
      submit: byId('welcome-submit')
    };

    session.require()
      .then(function (user) {
        if (!user) return null;
        ui.year();

        return profile.load().then(function (row) {
          /* Already done. Somebody who typed the address in by hand, or came
             back on the browser's history, goes where they meant to go. */
          if (row && row.username && row.first_name) {
            window.location.replace('dashboard.html');
            return null;
          }
          return fill(row, user).then(function () { return true; });
        });
      })
      .then(function (ready) {
        if (!ready) return;
        document.body.classList.remove('booting');
        dom.form.addEventListener('submit', submit);
        dom.username.addEventListener('input', checkAvailability);
        dom.first.focus();
      })
      .catch(function (error) {
        document.body.classList.remove('booting');
        ui.toast('Could not open your account. ' +
          (error && error.message ? error.message : 'Please reload.'),
          { duration: 12000 });
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.MyMon);
