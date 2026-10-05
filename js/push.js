/* MyMon — making the phone ring when MyMon is closed.

   The bell in the header is a different thing: it reads a table when you open
   the app. This file is about the other case, where nothing of MyMon is open
   at all and the notification has to come from outside.

   Three parties are involved, and it is worth naming them once:

     the browser      hands out a subscription — an address at Google, Apple
                      or Mozilla that forwards to this one device, plus two
                      keys so the forwarder cannot read what passes through
     this file        records that subscription against your account
     the server       posts to the address when something happens

   Only the first two live here. The last one is a function on Supabase, and
   until the project has its VAPID keys there is nothing for a browser to
   subscribe *to* — which is why `state()` has an answer for that case rather
   than failing. */
window.MyMon = window.MyMon || {};

(function (NS) {
  'use strict';

  function client() {
    var found = NS.session && NS.session.client;
    if (!found) throw new Error('MyMon is not connected to the database.');
    return found;
  }

  function publicKey() {
    var config = NS.config || {};
    return (config.vapidPublicKey || '').trim();
  }

  /* The subscribe call wants the key as bytes, and it arrives as the URL-safe
     base64 that every VAPID tool prints. */
  function keyBytes(base64) {
    var padded = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4) padded += '=';

    var raw = window.atob(padded);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  /* Running from the home screen rather than in a browser tab. */
  function isInstalled() {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    return window.navigator.standalone === true;      /* Safari's own flag */
  }

  /* iPadOS calls itself a Mac and is only told apart by the touch points —
     the same test `js/install.js` makes, for the same reason. */
  function isApple() {
    var ua = window.navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    return window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
  }

  /* Something short to show beside the device in Settings. A guess, and
     treated as one: it is a label, never evidence. */
  function label() {
    var ua = window.navigator.userAgent;

    var browser = 'A browser';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/OPR\//.test(ua)) browser = 'Opera';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Chrome\//.test(ua)) browser = 'Chrome';
    else if (/Safari\//.test(ua)) browser = 'Safari';

    var where = 'this device';
    if (/Android/i.test(ua)) where = 'Android';
    else if (isApple()) where = /iPad/i.test(ua) ? 'iPad' : 'iPhone';
    else if (/Windows/i.test(ua)) where = 'Windows';
    else if (/Mac OS X/i.test(ua)) where = 'a Mac';
    else if (/Linux/i.test(ua)) where = 'Linux';

    return browser + ' on ' + where;
  }

  /* ---------- where things stand ------------------------------------------ */

  /* One of:
       no-key         the project has no VAPID key yet — nothing to subscribe to
       unsupported    this browser cannot do push at all
       needs-install  an iPhone in a Safari tab: it can, but only once installed
       blocked        permission was refused, and a page cannot ask again
       off            it could be on, and is not
       on             this device is recorded and will ring

     Asynchronous because the honest answer depends on whether a subscription
     already exists, and only the service worker knows that. */
  function state() {
    if (!publicKey()) return Promise.resolve('no-key');

    var can = 'serviceWorker' in window.navigator &&
              'PushManager' in window &&
              'Notification' in window;

    /* On an iPhone none of those three exist until MyMon is on the home
       screen, so this order matters: say "install it" rather than the flatly
       wrong "your phone cannot do this". */
    if (!can) return Promise.resolve(isApple() && !isInstalled() ? 'needs-install' : 'unsupported');
    if (isApple() && !isInstalled()) return Promise.resolve('needs-install');

    if (window.Notification.permission === 'denied') return Promise.resolve('blocked');

    return window.navigator.serviceWorker.ready
      .then(function (registration) { return registration.pushManager.getSubscription(); })
      .then(function (subscription) { return subscription ? 'on' : 'off'; })
      .catch(function () { return 'off'; });
  }

  /* ---------- turning it on and off --------------------------------------- */

  /* Write a subscription down against whoever is signed in now. The database
     function deletes any earlier claim on the same address first, so a phone
     that changed hands stops ringing for the person who left it. */
  function remember(subscription) {
    var keys = subscription.toJSON().keys || {};

    return client().rpc('remember_push', {
      sub_endpoint: subscription.endpoint,
      sub_p256dh: keys.p256dh,
      sub_auth: keys.auth,
      sub_label: label()
    }).then(function (response) {
      if (response.error) throw response.error;
      return response.data;                 /* 'remembered' | 'bad_endpoint' | ... */
    });
  }

  /* Must be called from a click. Safari refuses to ask otherwise, and Chrome
     is heading the same way. */
  function turnOn() {
    return state().then(function (now) {
      if (now === 'on') return { ok: true, state: 'on' };

      if (now === 'no-key') {
        return { ok: false, state: now, error: 'MyMon is not set up to send these yet.' };
      }
      if (now === 'needs-install') {
        return { ok: false, state: now,
                 error: 'Add MyMon to your home screen first — on an iPhone that is the only way.' };
      }
      if (now === 'unsupported') {
        return { ok: false, state: now, error: 'This browser cannot show notifications.' };
      }
      if (now === 'blocked') {
        return { ok: false, state: now,
                 error: 'Your browser is set to refuse notifications from MyMon. ' +
                        'That has to be changed in the browser, not here.' };
      }

      return window.Notification.requestPermission().then(function (answer) {
        if (answer !== 'granted') {
          return { ok: false, state: answer === 'denied' ? 'blocked' : 'off',
                   error: 'Not allowed, so nothing will ring.' };
        }

        return window.navigator.serviceWorker.ready
          .then(function (registration) {
            return registration.pushManager.subscribe({
              /* Required, and the browsers enforce it: every message must be
                 one a person can see. There is no silent push here. */
              userVisibleOnly: true,
              applicationServerKey: keyBytes(publicKey())
            });
          })
          .then(function (subscription) {
            return remember(subscription).then(function (said) {
              if (said === 'remembered') return { ok: true, state: 'on' };

              /* Recorded nowhere is worse than not subscribed at all: the
                 browser would hold a subscription this account never knows to
                 send to. Undo it rather than leave that behind. */
              return subscription.unsubscribe().then(function () {
                return { ok: false, state: 'off', error: 'Could not save this device.' };
              });
            });
          });
      });
    });
  }

  /* Off means both halves: the browser stops holding a subscription, and the
     row goes. Either one alone leaves a phone that rings for nobody, or a row
     that points at a device which will refuse the message. */
  function turnOff() {
    return window.navigator.serviceWorker.ready
      .then(function (registration) { return registration.pushManager.getSubscription(); })
      .then(function (subscription) {
        if (!subscription) return { ok: true, state: 'off' };

        var endpoint = subscription.endpoint;

        return subscription.unsubscribe()
          .then(function () {
            return client().from('push_subscriptions').delete().eq('endpoint', endpoint);
          })
          .then(function (response) {
            if (response && response.error) throw response.error;
            return { ok: true, state: 'off' };
          });
      })
      .catch(function () {
        return { ok: false, state: 'off', error: 'Could not turn these off.' };
      });
  }

  /* ---------- keeping the record true ------------------------------------- */

  /* Called on every load of a signed-in page, and it is the repair for two
     things at once:

       the browser quietly replaced the subscription — they expire, and push
       services rotate them — and the service worker cannot write the new one
       down because, woken without a page, it has no token to write with;

       somebody else signed in on this device, and the row still names the
       person who left.

     Cheap, idempotent, and silent: a failure here must never interrupt what
     the person actually opened the page to do. */
  function sync() {
    if (!publicKey()) return Promise.resolve(false);
    if (!('serviceWorker' in window.navigator) || !('PushManager' in window)) {
      return Promise.resolve(false);
    }

    return window.navigator.serviceWorker.ready
      .then(function (registration) { return registration.pushManager.getSubscription(); })
      .then(function (subscription) {
        if (!subscription) return false;
        return remember(subscription).then(function (said) { return said === 'remembered'; });
      })
      .catch(function () { return false; });
  }

  NS.push = {
    state: state,
    turnOn: turnOn,
    turnOff: turnOff,
    sync: sync,
    label: label,
    isInstalled: isInstalled
  };
})(window.MyMon);
