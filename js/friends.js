/* MyMon — friends.
   The list that remembers a username so you do not have to.

   Nothing here decides who may be friends with whom, or who may read whose
   name. Every row below is one the database was willing to hand over, and a
   request can only be made through a function that takes a username and gives
   back a word — the browser never learns an account id it did not already
   have. The rules live in supabase/migrations/20261004230000_friends.sql.

   One row per pair, with the two ids stored smallest-first, so "are we
   friends" and "did one of us ask" are the same row. Which of the two is
   *you* is the only thing this file has to work out. */
window.MyMon = window.MyMon || {};
(function (NS) {
  'use strict';

  var TABLE = 'friendships';
  var COLUMNS = 'low_id, high_id, state, asked_by, asked_handle, created_at';

  var cache = { rows: [], people: {} };
  var loaded = false;

  function client() {
    var c = NS.session && NS.session.client;
    if (!c) throw new Error('MyMon is not connected to the database.');
    return c;
  }

  function me() {
    var who = NS.session && NS.session.get();
    return who ? who.id : null;
  }

  /* ---------- reading ------------------------------------------------------ */

  function load() {
    return Promise.all([
      client().from(TABLE).select(COLUMNS),
      /* Everyone this account is allowed to see a name for: itself, the people
         in its groups, its friends, and anybody who has asked to be one. */
      client().from('profiles').select('id, username, first_name, last_name')
    ]).then(function (answers) {
      answers.forEach(function (a) { if (a.error) throw a.error; });

      cache.rows = answers[0].data || [];

      cache.people = {};
      (answers[1].data || []).forEach(function (p) { cache.people[p.id] = p; });

      loaded = true;
      return all();
    });
  }

  function isLoaded() { return loaded; }

  /* The other one. A row holds two ids and says nothing about which is yours. */
  function otherIn(row) {
    return row.low_id === me() ? row.high_id : row.low_id;
  }

  /* A person as every list in MyMon writes one: a name to read, a handle under
     it, and a letter for the circle. Falls back through what is known.

     The handle on a request you sent is the one thing here that does not come
     from a profile — until they accept you cannot read it, so the database
     kept the username you typed. Without it the waiting list would be a row
     with nobody in it. */
  function personFor(row) {
    var id = otherIn(row);
    var p = cache.people[id] || {};

    var username = p.username || (row.asked_by === me() ? (row.asked_handle || '') : '');
    var fullName = [p.first_name || '', p.last_name || ''].join(' ').trim();

    return {
      id: id,
      username: username,
      title: fullName || (username ? '@' + username : 'Someone'),
      handle: username ? '@' + username : '',
      initial: (fullName || username || '?').trim().charAt(0).toUpperCase(),
      /* True while all we have is the handle they were asked by — the screen
         uses it to avoid promising a name it does not have. */
      unnamed: !fullName
    };
  }

  function decorate(row) {
    var person = personFor(row);
    person.state = row.state;
    person.theyAsked = row.asked_by !== me();
    person.since = row.created_at;
    return person;
  }

  function pick(test) {
    return cache.rows.filter(test).map(decorate);
  }

  /* Alphabetical, because a friends list is something you scan for a name
     rather than read top to bottom. */
  function byName(a, b) {
    return (a.title || '').toLowerCase() < (b.title || '').toLowerCase() ? -1 : 1;
  }

  function all() {
    return pick(function (r) { return r.state === 'accepted'; }).sort(byName);
  }

  /* Newest first: these are things to answer, and the newest is the one you
     have not seen. */
  function byNewest(a, b) { return (a.since || '') < (b.since || '') ? 1 : -1; }

  function waitingOnMe() {
    return pick(function (r) {
      return r.state === 'pending' && r.asked_by !== me();
    }).sort(byNewest);
  }

  function waitingOnThem() {
    return pick(function (r) {
      return r.state === 'pending' && r.asked_by === me();
    }).sort(byNewest);
  }

  /* Is this person already somewhere in the list? Used by the group invite
     screen, which offers your friends and should not offer a stranger. */
  function standingWith(userId) {
    for (var i = 0; i < cache.rows.length; i++) {
      if (otherIn(cache.rows[i]) === userId) return cache.rows[i].state;
    }
    return null;
  }

  /* ---------- asking ------------------------------------------------------- */

  /* The database answers in one word. Each is a sentence here, because "self"
     on a screen is not an explanation. */
  var SAID = {
    asked: null,                                        /* the good ending */
    not_signed_in:   'You are not signed in.',
    no_such_user:    'No MyMon account has that username.',
    self:            'That one is you.',
    already_friends: 'You two are already friends.',
    already_asked:   'You have asked them already — it is waiting on them.',
    they_asked_you:  'They asked you first. Their request is waiting below.'
  };

  function ask(username) {
    var candidate = String(username == null ? '' : username)
      .trim().replace(/^@+/, '').trim();

    if (!candidate) {
      return Promise.resolve({ ok: false, error: 'Type their username.' });
    }

    return client().rpc('ask_to_be_friends', { candidate: candidate })
      .then(function (response) {
        if (response.error) throw response.error;

        var said = response.data;
        if (said !== 'asked') {
          /* A word this version does not know about is still a refusal; say so
             rather than claiming it worked. */
          return { ok: false, error: SAID[said] || 'That did not work.', said: said };
        }

        /* The row is the database's to describe, so memory is refreshed from
           it rather than guessed at here. */
        return load().then(function () { return { ok: true, said: said }; });
      });
  }

  /* ---------- answering ---------------------------------------------------- */

  function rowWith(userId) {
    for (var i = 0; i < cache.rows.length; i++) {
      if (otherIn(cache.rows[i]) === userId) return cache.rows[i];
    }
    return null;
  }

  function accept(userId) {
    var row = rowWith(userId);
    if (!row) return Promise.reject(new Error('That request is no longer there.'));

    return client().from(TABLE)
      .update({ state: 'accepted' })
      .eq('low_id', row.low_id)
      .eq('high_id', row.high_id)
      .then(function (response) {
        if (response.error) throw response.error;
        return load();
      });
  }

  /* One word for three things, because they are the same act: declining a
     request, taking back one you sent, and unfriending. Each is "this row
     should not exist". */
  function remove(userId) {
    var row = rowWith(userId);
    if (!row) return Promise.resolve();

    return client().from(TABLE)
      .delete()
      .eq('low_id', row.low_id)
      .eq('high_id', row.high_id)
      .then(function (response) {
        if (response.error) throw response.error;
        return load();
      });
  }

  NS.friends = {
    load: load,
    isLoaded: isLoaded,
    all: all,
    waitingOnMe: waitingOnMe,
    waitingOnThem: waitingOnThem,
    standingWith: standingWith,
    ask: ask,
    accept: accept,
    remove: remove
  };
}(window.MyMon));
