/* MyMon — service worker.
   Its job is to make the app installable and to keep it opening when the
   network is slow or gone. It is deliberately network-first: a cache-first
   worker would keep serving yesterday's code long after a fix went out.

   It never touches anything that is not served from this site, so requests to
   Supabase, Google and the CDN pass straight through untouched. */

var VERSION = 'mymon-v1.4';   /* its own counter — only has to change, not match the app version */

/* The pages and files worth having ready before they are asked for. */
var SHELL = [
  './',
  'index.html',
  'dashboard.html',
  'settings.html',
  'about.html',
  'welcome.html',
  'style.css',
  'vendor/supabase.js',
  'js/config.js',
  'js/session.js',
  'js/data.js',
  'js/ui.js',
  'js/xlsx.js',
  'js/landing.js',
  'js/install.js',
  'js/dashboard.js',
  'js/welcome.js',
  'js/groups.js',
  'js/groupboard.js',
  'js/notifications.js',
  'js/friends.js',
  'js/friendboard.js',
  'js/settings.js',
  'js/profile.js',
  'js/push.js',
  'favicon.ico',
  'badge-72.png',
  'icon-192.png',
  'apple-touch-icon.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'manifest.webmanifest'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION)
      /* One missing file must not sink the whole install. */
      .then(function (cache) {
        return Promise.all(SHELL.map(function (url) {
          return cache.add(url).catch(function () { return null; });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          return key === VERSION ? null : caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;

  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then(function (response) {
        /* Keep a fresh copy for the next time the network is not there. */
        if (response && response.status === 200 && response.type === 'basic') {
          var copy = response.clone();
          caches.open(VERSION).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      })
      .catch(function () {
        return caches.match(request).then(function (hit) {
          if (hit) return hit;
          /* An address we never cached, offline: show the landing page rather
             than the browser's error. */
          if (request.mode === 'navigate') return caches.match('index.html');
          return Response.error();
        });
      })
  );
});

/* ---------------------------------------------------------------------------
   Notifications that arrive when MyMon is not open.

   This is the only part of the service worker that runs without a page. The
   browser wakes it, hands it a message, and gives it a few seconds — and if
   nothing is shown in that time, some browsers show a notice of their own
   saying a site sent a message in the background. So the one rule here is:
   always show something, even if the message was unreadable.
   --------------------------------------------------------------------------- */

var FALLBACK = {
  title: 'MyMon',
  body: 'Something happened in MyMon.',
  url: 'dashboard.html'
};

self.addEventListener('push', function (event) {
  var news = FALLBACK;

  if (event.data) {
    try {
      var sent = event.data.json();
      news = {
        title: sent.title || FALLBACK.title,
        /* Empty, not the fallback line. The sentence the server sends is the
           title — "Ana commented in Rent" — and a second line reading
           "Something happened in MyMon" underneath it would be noise that
           contradicts nothing and says less. */
        body: sent.body || '',
        url: sent.url || FALLBACK.url,
        tag: sent.tag
      };
    } catch (ignored) {
      /* Not our JSON. Showing the fallback beats showing nothing. */
    }
  }

  event.waitUntil(
    self.registration.showNotification(news.title, {
      body: news.body,
      icon: 'icon-192.png',
      badge: 'badge-72.png',

      /* A tag collapses repeats: three comments on the same expense while the
         phone is in a pocket become one line, not three. Without it, a busy
         group turns the lock screen into a wall. */
      tag: news.tag || 'mymon',
      renotify: true,

      /* Where the tap goes. Kept on the notification rather than guessed
         later, because by then the message is gone. */
      data: { url: news.url }
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  var target = (event.notification.data && event.notification.data.url) || FALLBACK.url;
  var full = new URL(target, self.location.href).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (open) {
        /* A tab of MyMon is already there: send it where the notification
           points instead of opening a second copy. Opening another window
           every time is how people end up with nine of them. */
        for (var i = 0; i < open.length; i++) {
          var client = open[i];
          if (client.url.indexOf(self.registration.scope) !== 0) continue;

          if (!client.navigate) return client.focus();
          return client.navigate(full)
            .then(function (moved) { return (moved || client).focus(); })
            /* navigate() refuses on a page this worker does not control yet.
               Focusing the wrong page still beats doing nothing. */
            .catch(function () { return client.focus(); });
        }

        return self.clients.openWindow(full);
      })
  );
});

/* The browser may replace a subscription on its own — it expires, or the push
   service rotates it. There is deliberately no handler for that here: writing
   the new one down needs the signed-in person's token, and a service worker
   woken with no page has no token to use. The repair is in the page instead,
   which records its subscription on every load, so the next time MyMon is
   opened the new one lands in the table. A handler here could only fail
   quietly, which is worse than not having one. */
