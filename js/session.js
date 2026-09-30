/* MyMon — session.
   v1 has no server, so "being logged in" simply means this browser remembers a
   name. No password is asked for and none is stored. When a real backend shows
   up, these four functions are the seam to replace. */
window.MyMon = window.MyMon || {};

(function (NS) {
  'use strict';

  var KEY = 'mymon.user.v1';
  var memoryFallback = null;

  function get() {
    if (memoryFallback) return memoryFallback;
    var raw;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (err) {
      return null;
    }
    if (!raw) return null;
    try {
      var user = JSON.parse(raw);
      return user && typeof user.name === 'string' && user.name ? user : null;
    } catch (err) {
      return null;
    }
  }

  function signIn(name) {
    var clean = String(name || '').trim().slice(0, 40);
    if (!clean) return null;
    var user = { name: clean, since: new Date().toISOString() };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(user));
    } catch (err) {
      memoryFallback = user;
    }
    return user;
  }

  function signOut() {
    memoryFallback = null;
    try {
      window.localStorage.removeItem(KEY);
    } catch (err) { /* nothing to clear */ }
  }

  /* Dashboard guard: bounce anonymous visitors back to the landing page. */
  function require() {
    var user = get();
    if (!user) {
      window.location.replace('index.html');
      return null;
    }
    return user;
  }

  /* Landing guard: a signed-in visitor entering the site goes straight to the
     dashboard, as the spec asks. index.html?stay=1 opts out, so the dashboard
     logo can still lead back here. */
  function redirectIfSignedIn() {
    if (window.location.search.indexOf('stay=1') !== -1) return false;
    if (!get()) return false;
    window.location.replace('dashboard.html');
    return true;
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  NS.session = {
    get: get,
    signIn: signIn,
    signOut: signOut,
    require: require,
    redirectIfSignedIn: redirectIfSignedIn,
    initials: initials
  };
})(window.MyMon);
