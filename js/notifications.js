/* MyMon — the bell, and what hangs off it.
   Two halves in one small file: the reads that fetch what you have been told,
   and the panel that shows it.

   Nothing here decides who may be told what. Every row below is one the
   database was willing to hand over, and no browser can write one — there is
   no insert policy on the table for anybody, and the rows are made by triggers
   instead. The rules live in
   supabase/migrations/20261004200000_notifications.sql and nowhere else.

   This runs on pages that know nothing about groups — the landing page has no
   js/groups.js — so it fetches the few names and group names it needs itself
   rather than borrowing that module's cache. */
window.MyMon = window.MyMon || {};
(function (NS) {
  'use strict';

  var TABLE = 'notifications';

  /* The group's name and the entry's note come along for the ride: both are
     reached by a foreign key, and both are filtered by the same rules as if
     they had been asked for on their own. */
  var SELECT =
    'id, kind, actor_id, group_id, entry_id, comment_id, created_at, read_at, ' +
    'groups(name), group_expenses(comment, category)';

  var HOW_MANY = 30;

  var rows = [];
  var names = {};
  var loaded = false;
  var open = false;
  var dom = {};

  function client() {
    var c = NS.session && NS.session.client;
    if (!c) throw new Error('MyMon is not connected.');
    return c;
  }

  function esc(value) { return NS.ui.escapeHtml(String(value == null ? '' : value)); }
  function byId(id) { return document.getElementById(id); }

  /* ---------- reading ------------------------------------------------------ */

  function load() {
    return Promise.all([
      client().from(TABLE).select(SELECT).order('created_at', { ascending: false }).limit(HOW_MANY),
      /* Whoever caused these is somebody you share a group with, so the rules
         on profiles already let you read their name. */
      client().from('profiles').select('id, username, first_name, last_name')
    ]).then(function (answers) {
      answers.forEach(function (a) { if (a.error) throw a.error; });

      rows = answers[0].data || [];

      names = {};
      (answers[1].data || []).forEach(function (p) {
        names[p.id] = {
          username: p.username || '',
          full: [p.first_name || '', p.last_name || ''].join(' ').trim()
        };
      });

      loaded = true;
      return rows;
    });
  }

  function who(userId) {
    var row = names[userId] || {};
    return row.full || (row.username ? '@' + row.username : 'Somebody');
  }

  function unread() {
    return rows.filter(function (r) { return !r.read_at; }).length;
  }

  function markAllRead() {
    var mine = rows.filter(function (r) { return !r.read_at; });
    if (!mine.length) return Promise.resolve();

    var when = new Date().toISOString();
    mine.forEach(function (r) { r.read_at = when; });   /* paint first */
    render();

    return Promise.all(mine.map(function (r) {
      return client().from(TABLE).update({ read_at: when }).eq('id', r.id);
    })).catch(function (error) {
      if (window.console) window.console.warn('notifications: ' + (error && error.message));
    });
  }

  function markRead(id) {
    var row = rows.filter(function (r) { return r.id === id; })[0];
    if (!row || row.read_at) return Promise.resolve();

    var when = new Date().toISOString();
    row.read_at = when;
    return client().from(TABLE).update({ read_at: when }).eq('id', id);
  }

  /* ---------- saying it in words ------------------------------------------- */

  /* "2h", "yesterday", "4 Oct". Short, because the row is already two lines. */
  function when(iso) {
    var then = new Date(iso);
    var mins = Math.round((Date.now() - then.getTime()) / 60000);

    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    if (mins < 60 * 24) return Math.round(mins / 60) + 'h ago';
    if (mins < 60 * 48) return 'yesterday';

    return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  /* What the entry was, for a comment. The note if it has one, the category if
     it does not — never an empty pair of quotes. */
  function entryName(row) {
    var entry = row.group_expenses;
    if (!entry) return 'an expense';

    if (entry.comment) return entry.comment;

    var cat = NS.data && NS.data.categoryById && NS.data.categoryById(entry.category);
    return cat ? cat.label : 'an expense';
  }

  function sentence(row) {
    var actor = '<b>' + esc(who(row.actor_id)) + '</b>';
    var group = '<b>' + esc((row.groups && row.groups.name) || 'a group') + '</b>';

    if (row.kind === 'group_invite') return actor + ' invited you to ' + group;
    if (row.kind === 'comment_on_mine') {
      return actor + ' commented on your <b>' + esc(entryName(row)) + '</b>';
    }
    return actor + ' commented in ' + group;
  }

  /* Where the row takes you. A notification exists to be followed. */
  function destination(row) {
    var hash = '#groups';
    if (row.group_id) hash += '/' + row.group_id;
    if (row.entry_id) hash += '/' + row.entry_id;
    return 'dashboard.html' + hash;
  }

  /* ---------- the panel ---------------------------------------------------- */

  function rowHtml(row) {
    return '' +
      '<li>' +
        '<button class="note-row' + (row.read_at ? '' : ' note-row--new') + '" type="button" ' +
                'data-note="' + esc(row.id) + '">' +
          '<span class="badge" aria-hidden="true">' +
            esc((who(row.actor_id) || '?').trim().charAt(0).toUpperCase()) +
          '</span>' +
          '<span class="note-row__text">' + sentence(row) +
            '<span class="note-row__when">' + esc(when(row.created_at)) + '</span>' +
          '</span>' +
          (row.read_at ? '' : '<span class="note-row__dot" aria-hidden="true"></span>') +
        '</button>' +
      '</li>';
  }

  function render() {
    if (!dom.count) return;

    var n = unread();
    dom.count.textContent = n > 9 ? '9+' : String(n);
    dom.count.classList.toggle('hidden', n === 0);
    dom.button.setAttribute('aria-label',
      n === 0 ? 'Notifications' : 'Notifications, ' + n + ' unread');

    if (!open) return;

    dom.panel.innerHTML =
      '<div class="bell__head">' +
        '<h2 class="bell__title">Notifications</h2>' +
        (n ? '<button class="btn btn--quiet" type="button" data-read-all>Mark all read</button>'
           : '') +
      '</div>' +
      (rows.length
        ? '<ul class="bell__list">' + rows.map(rowHtml).join('') + '</ul>'
        : '<p class="bell__empty">Nothing new.</p>');
  }

  function show() {
    open = true;
    dom.panel.classList.remove('hidden');
    dom.button.setAttribute('aria-expanded', 'true');
    render();

    /* Opening clears the count. The rows keep their own dot until they are
       followed or the whole lot is marked — otherwise you either lose track of
       which ones you had not seen, or you have to tick each one by hand. */
    var fresh = rows.filter(function (r) { return !r.read_at; });
    if (!fresh.length) return;

    var when_ = new Date().toISOString();
    Promise.all(fresh.map(function (r) {
      return client().from(TABLE).update({ read_at: when_ }).eq('id', r.id);
    })).then(function () {
      fresh.forEach(function (r) { r.seen = true; });
    }).catch(function (error) {
      if (window.console) window.console.warn('notifications: ' + (error && error.message));
    });

    /* The badge goes now; the dots stay until the panel is closed and opened. */
    dom.count.classList.add('hidden');
  }

  function hide() {
    if (!open) return;
    open = false;
    dom.panel.classList.add('hidden');
    dom.button.setAttribute('aria-expanded', 'false');

    /* Everything shown has now been seen. */
    rows.forEach(function (r) { if (r.seen) { r.read_at = r.read_at || new Date().toISOString(); } });
    render();
  }

  function wire() {
    dom.button.addEventListener('click', function (event) {
      event.stopPropagation();
      if (open) hide(); else show();
    });

    dom.panel.addEventListener('click', function (event) {
      event.stopPropagation();

      if (event.target.closest('[data-read-all]')) {
        markAllRead();
        return;
      }

      var hit = event.target.closest('[data-note]');
      if (!hit) return;

      var id = hit.dataset.note;
      var row = rows.filter(function (r) { return r.id === id; })[0];
      if (!row) return;

      markRead(id);
      window.location.href = destination(row);
    });

    /* Anywhere else, and Escape, close it. */
    document.addEventListener('click', function () { hide(); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') hide();
    });
  }

  function start() {
    dom = {
      button: byId('bell-btn'),
      panel: byId('bell-panel'),
      count: byId('bell-count')
    };
    if (!dom.button) return Promise.resolve();

    wire();

    return load()
      .then(render)
      .catch(function (error) {
        /* A bell that cannot load is a bell with nothing in it, not a broken
           page. Everything else on the page still works. */
        if (window.console) window.console.warn('notifications: ' + (error && error.message));
      });
  }

  NS.notifications = {
    start: start,
    load: load,
    refresh: function () { return load().then(render); },
    unread: unread
  };
}(window.MyMon));
