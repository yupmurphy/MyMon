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

        /* Already signed in — sending them back through Google would ask them
           to pick an account again, which reads as having been logged out. */
        if (session.get()) {
          window.location.href = 'dashboard.html';
          return;
        }

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

    /* Arriving straight from the sign out button. */
    if (window.location.search.indexOf('signedout=1') !== -1) {
      var done = document.getElementById('signed-out');
      if (done) done.classList.remove('hidden');
      if (window.history.replaceState) {
        window.history.replaceState({}, '', 'index.html');
      }
    }

    /* Someone who opened the site itself goes straight to the app; someone who
       clicked Home stays here and gets the signed-in version of the page. */
    session.redirectIfSignedIn().then(function (leaving) {
      if (leaving) return;

      ui.mountHeader({ page: 'home' });
      if (session.get()) NS.notifications.start();

      /* Now that the answer is certain, the guess in the head has nothing left
         to do — .hidden alone decides from here. */
      document.documentElement.removeAttribute('data-session');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.MyMon);
