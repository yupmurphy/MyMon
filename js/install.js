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

  /* Installed already, but being read in a browser tab rather than run as the
     app. The browser will not say so on its own — it simply stops offering to
     install, which looks from here like nothing happening at all. Asking costs
     one call, and anything the browser will not answer counts as "no". */
  function isInstalledHere() {
    if (!window.navigator.getInstalledRelatedApps) return Promise.resolve(false);
    return window.navigator.getInstalledRelatedApps()
      .then(function (apps) { return !!(apps && apps.length); })
      .catch(function () { return false; });
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
      mode = 'prompt';
      button.textContent = 'Install app';

      if (isTouchDevice()) {
        title.textContent = 'Keep MyMon on your phone';
        copy.textContent = 'It gets its own icon and opens without the browser bar, ' +
          'like any other app.';
      } else {
        title.textContent = 'Install MyMon on this computer';
        copy.textContent = 'It opens in its own window — no tabs, no address bar — ' +
          'and sits with your other apps.';
      }

      band.classList.remove('hidden');
    }

    /* Already installed. The button hands over through the protocol the app
       registered with the system when it was installed. */
    function offerOpenApp() {
      if (mode) return;                 /* an install offer outranks this one */
      mode = 'open';
      button.textContent = 'Open the app';
      title.textContent = isTouchDevice()
        ? 'MyMon is already on this device'
        : 'MyMon is installed on this computer';
      copy.textContent = 'This opens it in its own window, away from the browser.';
      band.classList.remove('hidden');
    }

    /* No API starts an installed app, so this navigates to the protocol the
       app claimed with the system. When the shortcut was never registered —
       the copy on this machine was installed before MyMon asked for one — the
       browser quietly does nothing, and the only sign is that this page never
       lost focus. Rather than leave a button that looks broken, say so. */
    function launchApp() {
      var left = false;
      function mark() { left = true; }

      window.addEventListener('blur', mark);
      window.addEventListener('pagehide', mark);
      window.location.href = 'web+mymon://open';

      window.setTimeout(function () {
        window.removeEventListener('blur', mark);
        window.removeEventListener('pagehide', mark);
        if (left) return;

        copy.textContent = 'Nothing opened. This copy was installed before MyMon ' +
          'had a shortcut to register — start it from your apps, or install it ' +
          'once more from here and the button will work.';
      }, 1800);
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

    /* The answer arrives a moment later, and only matters when nothing else
       claimed the band — a browser still offering to install has not installed
       anything yet. */
    isInstalledHere().then(function (yes) {
      if (yes) offerOpenApp();
    });

    button.addEventListener('click', function () {
      if (mode === 'open') {
        launchApp();
        return;
      }

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
