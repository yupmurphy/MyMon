/* MyMon — landing page.
   One job beyond the copy: take a name and hand it to the session. */
(function (NS) {
  'use strict';

  var ui = NS.ui;
  var session = NS.session;

  function init() {
    ui.mountHeader({ page: 'home' });
    ui.year();

    var dialog = document.getElementById('signin-dialog');
    var form = document.getElementById('signin-form');
    var input = document.getElementById('field-name');
    var field = form ? form.querySelector('[data-field="name"]') : null;
    var error = field ? field.querySelector('.field__error') : null;

    function open() {
      var user = session.get();
      if (user) {                       /* already signed in — just go through */
        window.location.href = 'dashboard.html';
        return;
      }
      if (field) field.classList.remove('field--invalid');
      form.reset();
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      window.setTimeout(function () { input.focus(); }, 30);
    }

    function close() {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }

    Array.prototype.forEach.call(document.querySelectorAll('[data-open-signin]'), function (btn) {
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        open();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-close-dialog]'), function (btn) {
      btn.addEventListener('click', close);
    });

    if (dialog) {
      dialog.addEventListener('click', function (event) {
        if (event.target === dialog) close();
      });
    }

    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var user = session.signIn(input.value);
        if (!user) {
          field.classList.add('field--invalid');
          if (error) error.textContent = 'Tell MyMon what to call you.';
          input.focus();
          return;
        }
        window.location.href = 'dashboard.html';
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.MyMon);
