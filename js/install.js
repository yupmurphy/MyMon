/* MyMon — the install button on the landing page.

   There is no single way to install a web app, so the button asks the browser
   what it can do and becomes one of three things:

     Chrome and friends  a real "Install app" button; the browser handed us its
                         own install dialog and we hold it until it is clicked
     iPhone              Safari has no such dialog, so the button opens the
                         three steps instead
     anywhere else       no button at all, rather than one that does nothing

   And a fourth case with no button in it at all: MyMon is already installed on
   this device. There used to be an "Open the app" button here, built on the
   one hack that exists — registering a `web+mymon` protocol and navigating to
   it. It was removed on 2026-10-05 because it does not work and cannot be made
   to. No browser offers a way for a page to start an installed app; that was
   taken away on purpose, so a site cannot open applications behind your back.
   The protocol trick depends on a separate permission Chrome asks for
   inconsistently, and when it has not been granted the navigation does nothing
   at all — silently. A button that fails silently is worse than no button, so
   this case now gets a sentence and nothing to press. */
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
      /* The "already installed" answer arrives late and hides the button. If a
         real install offer turns up after it, the button has to come back —
         otherwise the band says "Install app" with nothing to press. */
      button.hidden = false;
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

    /* Already installed. Nothing to press — see the note at the top of this
       file. Saying so is still worth the room: somebody who installed MyMon
       months ago and arrived here through a search result has no other way of
       learning that the icon is already on their device. */
    function offerOpenApp() {
      if (mode) return;                 /* an install offer outranks this one */
      mode = 'open';
      button.hidden = true;
      title.textContent = isTouchDevice()
        ? 'MyMon is already on this device'
        : 'MyMon is installed on this computer';
      copy.textContent = 'Open it from your apps, the way you open any other one.';
      band.classList.remove('hidden');
    }

    function offerAppleSteps() {
      if (mode === 'prompt') return;      /* a real dialog beats instructions */
      mode = 'ios';
      button.hidden = false;
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
