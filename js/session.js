/* MyMon — session.
   Real accounts now: Supabase handles signing in with Google and keeps the
   session. Nothing about passwords ever passes through this code.

   Everything here is asynchronous, because the browser has to ask the server
   who you are. `ready` is the promise every page waits on before it decides
   whether to show anything. */
window.MyMon = window.MyMon || {};

(function (NS) {
  'use strict';

  var config = NS.config || {};

  function looksFilledIn(value) {
    return typeof value === 'string' && value.length > 0 && value.indexOf('PASTE_') !== 0;
  }

  var configured = looksFilledIn(config.supabaseUrl) && looksFilledIn(config.supabaseKey);
  var libraryLoaded = !!(window.supabase && window.supabase.createClient);

  var client = null;
  var currentUser = null;
  var listeners = [];

  if (configured && libraryLoaded) {
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
  }

  /* Why the app cannot start, in words a person can act on. */
  function setupProblem() {
    if (!libraryLoaded) {
      return 'The Supabase library did not load. Check the internet connection, ' +
        'then reload the page.';
    }
    if (!configured) {
      return 'MyMon is not connected yet. Open js/config.js and paste your ' +
        'Supabase project URL and public key.';
    }
    return null;
  }

  /* Resolves once we know who is signed in — or that nobody is. When the user
     arrives back from Google, the library also finishes the handshake here. */
  var ready = (function () {
    if (!client) return Promise.resolve(null);

    return client.auth.getSession()
      .then(function (result) {
        currentUser = (result.data && result.data.session)
          ? result.data.session.user
          : null;

        client.auth.onAuthStateChange(function (event, session) {
          currentUser = session ? session.user : null;
          listeners.forEach(function (fn) { fn(profile()); });
        });

        return profile();
      })
      .catch(function () { return null; });
  })();

  /* The handful of fields the interface actually shows.
     A name set in Settings wins over the one Google supplied; leaving both
     parts empty falls back to Google again. */
  function profile() {
    if (!currentUser) return null;
    var meta = currentUser.user_metadata || {};
    var email = currentUser.email || '';

    var first = String(meta.first_name || '').trim();
    var last = String(meta.last_name || '').trim();
    var chosen = (first + ' ' + last).trim();

    return {
      id: currentUser.id,
      email: email,
      firstName: first,
      lastName: last,
      googleName: meta.full_name || meta.name || '',
      name: chosen || meta.full_name || meta.name || email.split('@')[0] || 'there',
      avatar: meta.avatar_url || meta.picture || ''
    };
  }

  /* Stored on the account itself, so the name follows you to any device.
     user_metadata is writable by its owner, which is right for a display name
     and wrong for anything that grants permission — keep it to labels. */
  function updateName(firstName, lastName) {
    if (!client) return Promise.reject(new Error('MyMon is not connected.'));

    return client.auth.updateUser({
      data: {
        first_name: String(firstName || '').trim().slice(0, 40),
        last_name: String(lastName || '').trim().slice(0, 40)
      }
    }).then(function (result) {
      if (result.error) throw result.error;
      currentUser = result.data.user;
      listeners.forEach(function (fn) { fn(profile()); });
      return profile();
    });
  }

  function get() { return profile(); }

  function onChange(fn) { listeners.push(fn); }

  /* Resolve a sibling page against the current one, so the same code works on
     localhost and on the published site without knowing either address. */
  function pageUrl(page) {
    return new URL(page, window.location.href).href;
  }

  function signInWithGoogle() {
    var problem = setupProblem();
    if (problem) return Promise.reject(new Error(problem));

    return client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: pageUrl('dashboard.html'),

        /* Signing out of MyMon does not sign you out of Google, so without
           this Google would silently hand back the same account and the sign
           out button would look broken. This asks it to offer the chooser. */
        queryParams: { prompt: 'select_account' }
      }
    }).then(function (result) {
      if (result.error) throw result.error;
      return result;
    });
  }

  function signOut() {
    if (!client) return Promise.resolve();
    return client.auth.signOut().catch(function () { /* leaving anyway */ });
  }

  /* Dashboard guard. Anonymous visitors go back to the landing page. */
  function require() {
    return ready.then(function (user) {
      if (!user) {
        window.location.replace('index.html');
        return null;
      }
      return user;
    });
  }

  /* Landing guard. Someone already signed in goes straight to the app;
     index.html?stay=1 opts out so the logo can still lead back here. */
  function redirectIfSignedIn() {
    return ready.then(function (user) {
      if (!user) return false;
      if (window.location.search.indexOf('stay=1') !== -1) return false;
      window.location.replace('dashboard.html');
      return true;
    });
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  NS.session = {
    ready: ready,
    client: client,
    isConfigured: function () { return !!client; },
    setupProblem: setupProblem,
    get: get,
    onChange: onChange,
    updateName: updateName,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    require: require,
    redirectIfSignedIn: redirectIfSignedIn,
    initials: initials
  };
})(window.MyMon);
