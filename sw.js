/* MyMon — service worker.
   Its job is to make the app installable and to keep it opening when the
   network is slow or gone. It is deliberately network-first: a cache-first
   worker would keep serving yesterday's code long after a fix went out.

   It never touches anything that is not served from this site, so requests to
   Supabase, Google and the CDN pass straight through untouched. */

var VERSION = 'mymon-v1.1.15';   /* its own counter — only has to change, not match the app version */

/* The pages and files worth having ready before they are asked for. */
var SHELL = [
  './',
  'index.html',
  'dashboard.html',
  'settings.html',
  'about.html',
  'style.css',
  'vendor/supabase.js',
  'js/config.js',
  'js/session.js',
  'js/data.js',
  'js/ui.js',
  'js/landing.js',
  'js/install.js',
  'js/dashboard.js',
  'js/settings.js',
  'js/profile.js',
  'MyM.png',
  'favicon.ico',
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
