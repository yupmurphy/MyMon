/* MyMon — the Friends tab.

   Laid out to read like the Groups tab beside it: anything waiting on an
   answer sits on top as its own card, and the list is underneath. Somebody who
   has already learned one half of the dashboard should not have to learn the
   other.

   Nothing here decides who may see a name or be anybody's friend. Every row is
   one the database handed over, and the one write it makes goes through a
   function that takes a username. The rules live in
   supabase/migrations/20261004230000_friends.sql. */
(function (NS) {
  'use strict';

  var ui = NS.ui;
  var friends = NS.friends;

  var dom = {};
  var wired = false;

  /* What the add-a-friend box says underneath itself, kept across redraws —
     the panel is rebuilt wholesale on every change and a message written into
     it would be gone before it was read. */
  var note = { text: '', state: '' };

  function byId(id) { return document.getElementById(id); }
  function esc(value) { return ui.escapeHtml(String(value == null ? '' : value)); }

  function fail(what, error) {
    var detail = error && error.message ? error.message : 'Please try again.';
    ui.toast(what + ' ' + detail, { duration: 8000 });
  }

  /* ---------- drawing ------------------------------------------------------ */

  function badge(person) {
    return '<span class="badge" aria-hidden="true">' + esc(person.initial) + '</span>';
  }

  /* A request somebody has made of you. The same card a group invitation
     wears, because it is the same thing: a yes-or-no from another person. */
  function requestHtml(person) {
    return '' +
      '<section class="card invite">' +
        '<div class="invite__text">' +
          '<h3 class="invite__title">' + esc(person.title) + '</h3>' +
          '<p class="invite__note">' +
            (person.handle && !person.unnamed ? esc(person.handle) + ' wants' : 'Wants') +
            ' to be friends. Friends can be invited to a group by name instead of ' +
            'by username, and nothing else changes.' +
          '</p>' +
        '</div>' +
        '<div class="invite__tools">' +
          '<button class="btn btn--quiet" type="button" data-friend-no="' + esc(person.id) + '">' +
            'No thanks</button>' +
          '<button class="btn btn--primary" type="button" data-friend-yes="' + esc(person.id) + '">' +
            'Add</button>' +
        '</div>' +
      '</section>';
  }

  /* One person in a list. `waiting` greys them and changes what the × means. */
  function personHtml(person, waiting) {
    var label = person.title;

    return '<li class="person' + (waiting ? ' person--waiting' : '') + '"' +
        (!person.unnamed && person.handle ? ' title="' + esc(person.handle) + '"' : '') + '>' +
      badge(person) +
      '<span class="person__name">' + esc(label) + '</span>' +
      (waiting ? '<span class="person__tag">asked</span>' : '') +
      '<button class="person__drop" type="button" data-friend-drop="' + esc(person.id) + '" ' +
        'aria-label="' + (waiting ? 'Take back the request to ' : 'Remove ') + esc(label) + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
        'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '</button>' +
    '</li>';
  }

  function addBoxHtml() {
    return '' +
      '<div class="invite-row">' +
        '<label class="invite-row__label" for="friend-name">Add by username</label>' +
        /* The same @-in-front box Settings and the group invite use, so the
           sign is on the screen rather than something you have to know.
           Typing one anyway is harmless — friends.ask() takes it off. */
        '<div class="invite-row__fields">' +
          '<div class="input-at">' +
            '<span aria-hidden="true">@</span>' +
            '<input id="friend-name" autocomplete="off" spellcheck="false" ' +
              'autocapitalize="none" maxlength="21" placeholder="their username" ' +
              'data-friend-field />' +
          '</div>' +
          '<button class="btn btn--ghost" type="button" data-friend-ask>Add</button>' +
        '</div>' +
        '<p class="field__hint"' + (note.state ? ' data-state="' + esc(note.state) + '"' : '') + '>' +
          (note.text
            ? esc(note.text)
            : 'They decide. Until they say yes they are not told anything about you ' +
              'beyond the name on your account.') +
        '</p>' +
      '</div>';
  }

  function emptyHtml() {
    return '<p class="muted" style="margin: .2rem 0 0">' +
      'Nobody yet. Add the people you share expenses with, and inviting them to a ' +
      'group becomes picking a name off a list.</p>';
  }

  function render() {
    if (!dom.view) return;

    var mine = friends.all();
    var theirs = friends.waitingOnMe();
    var sent = friends.waitingOnThem();

    renderBadge(theirs.length);

    dom.view.innerHTML =
      '<div class="groups-head">' +
        '<div>' +
          '<h2 class="groups-head__title">Friends</h2>' +
          '<p class="groups-head__note">A list so that inviting somebody to a group ' +
            'is picking a name, not remembering a username.</p>' +
        '</div>' +
      '</div>' +

      theirs.map(requestHtml).join('') +

      '<section class="card">' +
        '<div class="card__head">' +
          '<h2 class="card__title">Your friends</h2>' +
          (mine.length ? '<span class="card__hint">' + mine.length + '</span>' : '') +
        '</div>' +
        (mine.length
          ? '<ul class="people">' + mine.map(function (p) { return personHtml(p, false); }).join('') +
            '</ul>'
          : emptyHtml()) +
        addBoxHtml() +
      '</section>' +

      (sent.length
        ? '<section class="card" style="margin-top: 1.25rem">' +
            '<div class="card__head">' +
              '<h2 class="card__title">Waiting on them</h2>' +
            '</div>' +
            '<ul class="people">' +
              sent.map(function (p) { return personHtml(p, true); }).join('') +
            '</ul>' +
            '<p class="card__hint" style="white-space: normal; margin-top: .8rem">' +
              'You asked; they have not answered. Their name appears once they do &mdash; ' +
              'until then all you have is the username you typed.</p>' +
          '</section>'
        : '');
  }

  /* The count on the tab, so a request is visible from the other half of the
     dashboard. Only things waiting on *you* count: one you sent is not news. */
  function renderBadge(n) {
    if (!dom.badge) return;
    dom.badge.textContent = String(n);
    dom.badge.classList.toggle('hidden', n === 0);
  }

  /* ---------- doing -------------------------------------------------------- */

  function say(text, state) {
    note.text = text || '';
    note.state = state || '';
  }

  function ask() {
    var field = dom.view.querySelector('[data-friend-field]');
    if (!field) return;

    var typed = field.value;
    if (!typed.trim()) { field.focus(); return; }

    say('Asking…', '');
    render();

    friends.ask(typed).then(function (result) {
      if (!result.ok) {
        say(result.error, 'bad');
        render();

        /* The one refusal that is really an instruction: their request is
           already on the screen above, so put them next to it. */
        var again = dom.view.querySelector('[data-friend-field]');
        if (again && result.said !== 'they_asked_you') {
          again.value = typed;
          again.focus();
        }
        return;
      }

      say('Asked. It is waiting on them now.', 'good');
      render();
    }).catch(function (error) {
      say('', '');
      render();
      fail('Could not ask.', error);
    });
  }

  function accept(userId) {
    friends.accept(userId).then(function () {
      say('', '');
      render();
      ui.toast('You are friends now.');
    }).catch(function (error) { fail('Could not add them.', error); });
  }

  /* Declining, taking back, and unfriending are one act in the database and
     one function here; only the words differ. */
  function drop(userId, asked) {
    friends.remove(userId).then(function () {
      say('', '');
      render();
      if (asked) ui.toast('Request taken back.');
    }).catch(function (error) { fail('Could not do that.', error); });
  }

  function wire() {
    if (wired) return;
    wired = true;

    /* One listener for the whole panel: it is rebuilt on every change, so
       wiring each button would mean wiring them all again. */
    dom.view.addEventListener('click', function (event) {
      if (event.target.closest('[data-friend-ask]')) return ask();

      var yes = event.target.closest('[data-friend-yes]');
      if (yes) return accept(yes.dataset.friendYes);

      var no = event.target.closest('[data-friend-no]');
      if (no) return drop(no.dataset.friendNo, false);

      var off = event.target.closest('[data-friend-drop]');
      if (off) {
        var row = off.closest('.person');
        var waiting = !!(row && row.classList.contains('person--waiting'));

        /* Taking back something they have not seen needs no ceremony.
           Removing somebody does, because they will notice. */
        if (!waiting) {
          var name = row ? row.querySelector('.person__name').textContent : 'them';
          if (!window.confirm('Remove ' + name + ' from your friends?\n\n' +
              'Any group you share stays exactly as it is. You can add each ' +
              'other again later.')) return;
        }

        return drop(off.dataset.friendDrop, waiting);
      }
    });

    dom.view.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      if (!event.target.closest('[data-friend-field]')) return;
      event.preventDefault();      /* it is not in a form; Enter would do nothing */
      ask();
    });
  }

  /* ---------- start -------------------------------------------------------- */

  function start() {
    dom = {
      view: byId('friends-view'),
      badge: byId('tab-friends-badge')
    };
    if (!dom.view) return;

    wire();
    render();
  }

  NS.friendBoard = { start: start, refresh: render };
})(window.MyMon);
