/* MyMon — the install button on the landing page.

   There is no single way to install a web app, so the button asks the browser
   what it can do and becomes one of three things:

     Chrome and friends  a real "Install app" button; the browser handed us its
                         own install dialog and we hold it until it is clicked
     iPhone              Safari has no such dialog, so the button opens the
                         three steps instead
     anywhere else       no button at all, rather than one that does nothing */
(function (NS) {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  /* Already installed: the page is running from the home screen, not a tab. */
  function isInstalled() {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    return window.navigator.standalone === true;   /* Safari's own flag */
  }

  /* iPadOS reports itself as a Mac, and is only told apart by the touch points. */
  function isApplePhone() {
    var ua = window.navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    return window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
  }

  /* Chrome offers to install on a desktop too, and installing there is worth
     having — the app gets its own window and its own entry in the menu. But it
     is a different promise from the one a phone gets, so it needs its own
     words. The primary pointer is what separates them: a finger is coarse, a
     mouse is fine, and a laptop with a touchscreen still answers "fine". */
  function isTouchDevice() {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    return window.navigator.maxTouchPoints > 1;
  }

  function init() {
    var band = byId('install-band');
    var button = byId('install-btn');
    var title = byId('install-title');
    var copy = byId('install-copy');
    var dialog = byId('ios-install');

    if (!band || !button) return;
    if (isInstalled()) return;

    var mode = null;

    function offerBrowserInstall() {
      /* Chrome fires this on a desktop as well, but a page asking to be
         installed on the computer it is already open on is noise — and the
         browser keeps its own install button in the address bar for anyone
         who wants it there. The band is for phones. */
      if (!isTouchDevice()) return;

      mode = 'prompt';
      button.textContent = 'Install app';
      title.textContent = 'Keep MyMon on your phone';
      copy.textContent = 'It gets its own icon and opens without the browser bar, ' +
        'like any other app.';
      band.classList.remove('hidden');
    }

    function offerAppleSteps() {
      if (mode === 'prompt') return;      /* a real dialog beats instructions */
      mode = 'ios';
      button.textContent = 'Add to Home Screen';
      title.textContent = 'Keep MyMon on your iPhone';
      copy.textContent = 'Safari can put it on your home screen, with its own icon and no browser bar.';
      band.classList.remove('hidden');
    }

    /* The event may have fired before this script ran, which is why index.html
       catches it in the head and parks it here. */
    if (window.MyMonInstall && window.MyMonInstall.event) offerBrowserInstall();
    window.addEventListener('mymon:installable', offerBrowserInstall);

    if (isApplePhone()) offerAppleSteps();

    button.addEventListener('click', function () {
      if (mode === 'prompt' && window.MyMonInstall.event) {
        var prompt = window.MyMonInstall.event;
        window.MyMonInstall.event = null;      /* it can only be used once */

        prompt.prompt();
        prompt.userChoice.then(function (choice) {
          if (choice && choice.outcome === 'accepted') {
            band.classList.add('hidden');
          } else {
            /* Declined: put the button back so it can be changed later. */
            window.MyMonInstall.event = prompt;
          }
        });
        return;
      }

      if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      else if (dialog) dialog.setAttribute('open', '');
    });

    if (dialog) {
      Array.prototype.forEach.call(dialog.querySelectorAll('[data-close-install]'), function (close) {
        close.addEventListener('click', function () {
          if (typeof dialog.close === 'function') dialog.close();
          else dialog.removeAttribute('open');
        });
      });

      dialog.addEventListener('click', function (event) {
        if (event.target === dialog && typeof dialog.close === 'function') dialog.close();
      });
    }

    window.addEventListener('appinstalled', function () {
      band.classList.add('hidden');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.MyMon);
