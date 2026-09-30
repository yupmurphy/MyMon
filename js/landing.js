/* MyMon — landing page.
   One job beyond the copy: hand the visitor over to Google and let Supabase
   bring them back signed in. */
(function (NS) {
  'use strict';

  var ui = NS.ui;
  var session = NS.session;

  function init() {
    ui.year();

    var buttons = document.querySelectorAll('[data-signin]');
    var problem = document.getElementById('setup-problem');

    /* If the keys are missing, say so instead of letting the buttons fail
       silently — this is the first thing that goes wrong during setup. */
    function showProblem(message) {
      if (!problem) return;
      problem.textContent = message;
      problem.classList.remove('hidden');
    }

    function busy(state) {
      Array.prototype.forEach.call(buttons, function (btn) {
        btn.disabled = state;
        btn.dataset.busy = state ? '1' : '';
      });
    }

    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        busy(true);
        session.signInWithGoogle().catch(function (error) {
          busy(false);
          showProblem(error && error.message
            ? error.message
            : 'Could not reach Google. Try again in a moment.');
        });
      });
    });

    var setup = session.setupProblem();
    if (setup) showProblem(setup);

    /* Someone already signed in who lands here goes straight to the app. */
    session.redirectIfSignedIn().then(function () {
      ui.mountHeader({ page: 'home' });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.MyMon);
