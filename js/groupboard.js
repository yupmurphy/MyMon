/* MyMon — the Groups tab.

   Owns the two tabs at the top of the dashboard and everything inside the
   second one: the list of groups, one group's ledger, the invitations, the
   comments, and the three dialogs that go with them. The personal half is
   js/dashboard.js and the two barely speak — the only words between them are
   a copy button on an expense row and a nudge to repaint afterwards.

   Nothing here decides who may see or change anything. Every list below is
   whatever the database was willing to answer with, and every button that is
   hidden is hidden because it would be refused anyway. The rules live in
   supabase/migrations/20261001145917_groups_and_comments.sql and nowhere
   else. */
(function (NS) {
  'use strict';

  var data = NS.data;
  var ui = NS.ui;
  var groups = NS.groups;

  /* The one shape every "make a new thing" button wears, here and on the
     personal half. Three screens were offering the same action in three
     different outfits — a pill on Personal, a bar across the width of the
     group list, a small square inside a group — and a person learns the
     shape long before they read the word. */
  var PLUS =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
      'stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>';

  /* Which group is open, or null while the list is showing. */
  var openId = null;

  /* Which entry has its comments unfolded. One at a time: a group of friends
     reads one thread, not twelve. */
  var openThread = null;

  /* The entry being corrected, or null when the dialog is adding a new one. */
  var editingEntry = null;

  /* The group being renamed, or null when the dialog is making a new one. */
  var renamingId = null;

  /* The personal expense waiting for a group to be picked for it. */
  var copying = null;

  var dom = {};
  var wired = false;

  function byId(id) { return document.getElementById(id); }

  function fail(what, error) {
    var detail = error && error.message ? error.message : 'Please try again.';
    ui.toast(what + ' ' + detail, { duration: 8000 });
  }

  function esc(value) { return ui.escapeHtml(String(value == null ? '' : value)); }

  function count(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /* ---------- the two tabs ------------------------------------------------
     Which tab you are on is kept in the address rather than in a variable, so
     reloading, going back, and sending somebody the link all behave. */

  function tabFromHash() {
    return window.location.hash.indexOf('#groups') === 0 ? 'groups' : 'personal';
  }

  function showTab(name) {
    var onGroups = name === 'groups';

    dom.tabPersonal.classList.toggle('is-on', !onGroups);
    dom.tabGroups.classList.toggle('is-on', onGroups);
    dom.tabPersonal.setAttribute('aria-selected', String(!onGroups));
    dom.tabGroups.setAttribute('aria-selected', String(onGroups));
    dom.panelPersonal.classList.toggle('hidden', onGroups);
    dom.panelGroups.classList.toggle('hidden', !onGroups);

    if (onGroups) render();
  }

  function goToTab(name) {
    /* Writing the hash fires hashchange, which is what actually switches the
       tab — so there is one path in and not two that can disagree. */
    if (name === 'groups') window.location.hash = '#groups';
    else if (window.location.hash) window.location.hash = '';
    else showTab('personal');
  }

  /* ---------- rendering ---------------------------------------------------- */

  function render() {
    renderBadge();
    if (!dom.view) return;

    var group = openId ? groups.find(openId) : null;

    /* A group can disappear under you — somebody deleted it, or removed you
       from it — between one paint and the next. */
    if (openId && (!group || group.myState !== 'member')) openId = null;

    dom.view.innerHTML = openId ? groupHtml(groups.find(openId)) : listHtml();
  }

  /* The number on the tab is unanswered invitations only. A badge that counted
     groups would never go away, and would stop meaning anything. */
  function renderBadge() {
    if (!dom.badge) return;
    var waiting = groups.isLoaded() ? groups.invitations().length : 0;
    dom.badge.textContent = String(waiting);
    dom.badge.classList.toggle('hidden', waiting === 0);
  }

  /* ---------- the list ----------------------------------------------------- */

  function listHtml() {
    if (!groups.isLoaded()) return '<p class="muted-note">Loading&hellip;</p>';

    var waiting = groups.invitations();
    var mine = groups.all();

    return '' +
      '<div class="groups-head">' +
        '<div>' +
          '<h2 class="groups-head__title">Groups</h2>' +
          '<p class="groups-head__note">A group has its own expenses. Nothing of ' +
            'yours goes into one until you put it there.</p>' +
        '</div>' +
        '<button class="btn btn--primary" type="button" data-new-group>' +
          PLUS + 'New group</button>' +
      '</div>' +
      waiting.map(inviteHtml).join('') +
      (mine.length ? '<ul class="group-list">' + mine.map(cardHtml).join('') + '</ul>'
                   : (waiting.length ? '' : emptyHtml()));
  }

  function inviteHtml(group) {
    return '' +
      '<section class="card invite">' +
        '<div class="invite__text">' +
          '<h3 class="invite__title">' + esc(group.name) + '</h3>' +
          '<p class="invite__note">You have been invited. Until you join, this is ' +
            'all you can see of it.</p>' +
        '</div>' +
        '<div class="invite__tools">' +
          '<button class="btn btn--quiet" type="button" data-decline="' + esc(group.id) + '">' +
            'No thanks</button>' +
          '<button class="btn btn--primary" type="button" data-accept="' + esc(group.id) + '">' +
            'Join</button>' +
        '</div>' +
      '</section>';
  }

  function cardHtml(group) {
    var totals = groups.totalsOf(groups.entriesOf(group.id));

    return '' +
      '<li>' +
        '<button class="group-card" type="button" data-open="' + esc(group.id) + '">' +
          '<span class="group-card__name">' + esc(group.name) + '</span>' +
          '<span class="group-card__meta">' +
            count(group.people, 'person', 'people') + ' &middot; ' +
            count(group.entries, 'entry', 'entries') +
            (group.invitees ? ' &middot; ' + group.invitees + ' invited' : '') +
          '</span>' +
          '<span class="group-card__sum num">' +
            (totals.length
              ? totals.map(function (row) {
                  return esc(ui.money(row.total, row.currency));
                }).join('<span class="group-card__and" aria-hidden="true">+</span>')
              : '&mdash;') +
          '</span>' +
        '</button>' +
      '</li>';
  }

  function emptyHtml() {
    return '' +
      '<div class="empty">' +
        '<div class="empty__art" aria-hidden="true">' +
          '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" ' +
            'stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="24" cy="22" r="8"/><circle cx="44" cy="26" r="6"/>' +
            '<path d="M10 50c0-8 6.5-13 14-13s14 5 14 13"/>' +
            '<path d="M42 38c6 1 10 5.5 10 12"/>' +
          '</svg>' +
        '</div>' +
        '<h3>No groups yet</h3>' +
        '<p>Make one for a trip, a flat, or just to see what your friends spend.</p>' +
        '<button class="btn btn--primary" type="button" data-new-group>' +
          PLUS + 'New group</button>' +
      '</div>';
  }

  /* ---------- one group ---------------------------------------------------- */

  function groupHtml(group) {
    var entries = groups.entriesOf(group.id);
    var totals = groups.totalsOf(entries);

    return '' +
      '<button class="back-link" type="button" data-back>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M15 5l-7 7 7 7"/></svg>All groups</button>' +

      '<section class="card group-head">' +
        '<div class="group-head__row">' +
          '<h2 class="group-head__name">' + esc(group.name) + '</h2>' +
          '<div class="group-head__tools">' +
            (group.iOwnIt
              ? '<button class="btn btn--quiet" type="button" data-rename="' + esc(group.id) + '">' +
                  'Rename</button>' +
                '<button class="btn btn--quiet" type="button" data-delete-group="' + esc(group.id) + '">' +
                  'Delete group</button>'
              : '<button class="btn btn--quiet" type="button" data-leave="' + esc(group.id) + '">' +
                  'Leave</button>') +
          '</div>' +
        '</div>' +

        '<p class="group-head__sum num">' +
          (totals.length
            ? totals.map(function (row) {
                return esc(ui.money(row.total, row.currency));
              }).join('<span class="group-card__and" aria-hidden="true">+</span>')
            : '&mdash;') +
        '</p>' +
        '<p class="group-head__note">' + count(entries.length, 'entry', 'entries') +
          ' between ' + count(group.people, 'person', 'people') + '</p>' +

        peopleHtml(group) +
        (group.iOwnIt ? inviteFormHtml(group) : '') +
      '</section>' +

      sharesHtml(group, totals) +

      '<section class="card">' +
        '<div class="card__head">' +
          '<h2 class="card__title">What we spent</h2>' +
          '<button class="btn btn--primary" type="button" data-add-entry="' +
            esc(group.id) + '">' + PLUS + 'Add expense</button>' +
        '</div>' +
        (entries.length
          ? '<div class="tx-scroll"><div class="tx-stack">' + daysHtml(entries) + '</div></div>'
          : '<div class="empty"><h3>Nothing in here yet</h3>' +
            '<p>Add something, or copy an expense across from your own list.</p></div>') +
      '</section>';
  }

  function peopleHtml(group) {
    var members = groups.membersOf(group.id).filter(function (m) {
      return m.state === 'member' || m.state === 'invited';
    });

    /* The owner first, then everyone else, then the unanswered invitations. */
    members.sort(function (a, b) {
      var rank = function (m) {
        if (m.userId === group.ownerId) return 0;
        return m.state === 'member' ? 1 : 2;
      };
      return rank(a) - rank(b);
    });

    return '<ul class="people">' + members.map(function (m) {
      var isOwner = m.userId === group.ownerId;
      var person = groups.personOf(m.userId);
      var label = person.title;

      return '<li class="person' + (m.state === 'invited' ? ' person--waiting' : '') + '"' +
          (person.fullName && person.handle ? ' title="' + esc(person.handle) + '"' : '') + '>' +
        badgeHtml(person) +
        '<span class="person__name">' + esc(label) + '</span>' +
        (person.isMe && !isOwner ? '<span class="person__tag">you</span>' : '') +
        (isOwner ? '<span class="person__tag">' + (person.isMe ? 'you, made it' : 'made it') +
                   '</span>' : '') +
        (m.state === 'invited' ? '<span class="person__tag">invited</span>' : '') +
        (group.iOwnIt && !isOwner
          ? '<button class="person__drop" type="button" data-remove-member="' + esc(m.userId) + '"' +
            ' aria-label="Remove ' + esc(label) + ' from the group">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
            'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
            '</button>'
          : '') +
      '</li>';
    }).join('') + '</ul>';
  }

  function inviteFormHtml(group) {
    return '' +
      '<div class="invite-row">' +
        '<label class="invite-row__label" for="invite-name">Invite by username</label>' +
        /* The same @-in-front box the username field in Settings uses, so the
           sign is on the screen instead of being something you have to know.
           Typing one anyway is harmless — groups.invite() takes it off. */
        '<div class="invite-row__fields">' +
          '<div class="input-at">' +
            '<span aria-hidden="true">@</span>' +
            '<input id="invite-name" autocomplete="off" spellcheck="false" ' +
              'autocapitalize="none" maxlength="21" placeholder="their username" ' +
              'data-invite-field />' +
          '</div>' +
          '<button class="btn btn--ghost" type="button" data-invite="' + esc(group.id) + '">' +
            'Invite</button>' +
        '</div>' +
        '<p class="field__hint">They decide whether to join. Nothing of theirs comes ' +
          'with them, and nothing of yours goes to them until you put it in here.</p>' +
      '</div>';
  }

  /* Who put in how much. Only shown when more than one person has, and only
     for the currency with the most in it — two people and two currencies is a
     table, not a sentence, and nothing here adds across currencies. */
  function sharesHtml(group, totals) {
    if (!totals.length) return '';

    var currency = totals[0].currency;
    var rows = groups.shares(group.id, currency);
    if (rows.length < 2) return '';

    var biggest = rows[0].total;

    return '' +
      '<section class="card">' +
        '<div class="card__head">' +
          '<h2 class="card__title">Who put in what</h2>' +
          '<span class="card__hint">' + esc(currency) + '</span>' +
        '</div>' +
        '<ul class="shares">' + rows.map(function (row) {
          var width = biggest > 0 ? Math.max(2, (row.total / biggest) * 100) : 0;
          return '<li class="share">' +
            '<span class="share__who">' + esc(row.username) + '</span> ' +
            '<span class="share__track" aria-hidden="true"><span class="share__fill' +
              (row.isMe ? ' share__fill--me' : '') +
              '" style="--w: ' + width.toFixed(1) + '%"></span></span> ' +
            /* The bar is hidden from anything reading aloud: it says exactly
               what the figure beside it already says, and the name and the
               figure have to stay two words apart rather than run together. */
            '<span class="share__sum num">' + esc(ui.money(row.total, currency)) + '</span>' +
          '</li>';
        }).join('') + '</ul>' +
      '</section>';
  }

  /* The ledger, a heading per day — the same shape the personal list has, so
     the two read the same way. */
  function daysHtml(entries) {
    var days = [];
    var index = {};

    entries.forEach(function (entry) {
      if (!index[entry.date]) {
        index[entry.date] = { date: entry.date, items: [] };
        days.push(index[entry.date]);
      }
      index[entry.date].items.push(entry);
    });

    return days.map(function (day) {
      return '<div class="tx-group">' +
        '<h3 class="tx-day">' + esc(data.dayLabel(day.date)) + '</h3>' +
        '<ul class="tx-list">' + day.items.map(entryHtml).join('') + '</ul>' +
      '</div>';
    }).join('');
  }

  function entryHtml(entry) {
    var category = data.categoryById(entry.category);
    var written = ui.money(entry.amount, entry.currency);
    var mine = entry.userId === groups.me();
    var thread = groups.commentsOn(entry.id);
    var open = openThread === entry.id;

    return '' +
      '<li class="tx tx--group" style="--dot: ' + (category ? category.color : 'var(--ink-300)') + '">' +
        '<span class="tx__icon" aria-hidden="true">' + (category ? category.icon : '') + '</span>' +
        '<span class="tx__body">' +
          /* The space before the name is not decoration. Without it the two
             run together into one word for anything reading the page aloud —
             "Billsyou" — however far apart the margin pushes them. */
          '<span class="tx__cat">' + esc(category ? category.label : entry.category) +
            ' <span class="tx__who">' + esc(groups.usernameOf(entry.userId)) + '</span>' +
          '</span>' +
          (entry.comment
            ? '<span class="tx__note" title="' + esc(entry.comment) + '">' +
                esc(entry.comment) + '</span>'
            : '') +
        '</span>' +
        '<span class="tx__amount">' + esc(written) + '</span>' +
        '<span class="tx__tools">' +
          /* A count nobody can see until they hover is not a count. The button
             stays out of the way only while it has nothing to say. */
          '<button class="tx__tool' + (open || thread.length ? ' is-on' : '') + '" type="button" ' +
            'data-thread="' + esc(entry.id) + '" aria-expanded="' + (open ? 'true' : 'false') + '" ' +
            'aria-label="' + (thread.length ? count(thread.length, 'comment', 'comments')
                                            : 'Comment on this') + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
              'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-5.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8z"/></svg>' +
            (thread.length ? '<span class="tx__tool-count">' + thread.length + '</span>' : '') +
          '</button>' +
          (mine
            ? '<button class="tx__tool" type="button" data-edit-entry="' + esc(entry.id) + '" ' +
                'aria-label="Edit ' + esc(written) + '">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
                'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>' +
              '</button>' +
              '<button class="tx__tool tx__tool--danger" type="button" ' +
                'data-remove-entry="' + esc(entry.id) + '" aria-label="Delete ' + esc(written) + '">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
                'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
              '</button>'
            : '') +
        '</span>' +
        (open ? threadHtml(entry, thread) : '') +
      '</li>';
  }

  /* The letter badge. The same shape the MyMon logo has, in the same green:
     this is a person's mark inside this app, not an attempt at a photograph.

     Deliberately one colour for everybody rather than a hue picked from the
     name. A colour per person reads as meaning something, and the only thing
     it could mean here is already said in words beside it — and it would be a
     seventh, eighth, ninth colour on a page whose palette was checked for
     colour-blind separation as a fixed set. */
  function badgeHtml(person) {
    return '<span class="badge" aria-hidden="true">' + esc(person.initial) + '</span>';
  }

  function threadHtml(entry, thread) {
    var who = groups.me();

    return '' +
      '<div class="thread">' +
        (thread.length
          ? '<ul class="thread__list">' + thread.map(function (note) {
              var person = groups.personOf(note.authorId);

              return '<li class="note">' +
                badgeHtml(person) +
                '<span class="note__who">' +
                  '<b class="note__name">' + esc(person.title) + '</b>' +
                  /* The handle is left out when the name is already the handle,
                     rather than printed twice in two sizes. */
                  (person.handle && person.fullName
                    ? ' <i class="note__handle">' + esc(person.handle) + '</i>'
                    : '') +
                  (person.isMe ? ' <i class="note__tag">you</i>' : '') +
                '</span> ' +
                (note.authorId === who
                  ? '<button class="note__drop" type="button" data-remove-comment="' +
                    esc(note.id) + '" aria-label="Delete your comment">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                    'stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
                    '<path d="M6 6l12 12M18 6L6 18"/></svg></button>'
                  : '<span></span>') +
                '<span class="note__body">' + esc(note.body) + '</span>' +
              '</li>';
            }).join('') + '</ul>'
          : '<p class="thread__empty">No comments yet.</p>') +
        '<div class="thread__write">' +
          '<input class="input" maxlength="280" autocomplete="off" ' +
            'placeholder="Say something&hellip;" data-comment-field="' + esc(entry.id) + '" />' +
          '<button class="btn btn--ghost btn--sm" type="button" data-send-comment="' +
            esc(entry.id) + '">Send</button>' +
        '</div>' +
      '</div>';
  }

  /* ---------- the group dialog --------------------------------------------- */

  function openGroupDialog(groupId) {
    renamingId = groupId || null;
    var group = groupId ? groups.find(groupId) : null;

    byId('group-dialog-title').textContent = group ? 'Rename the group' : 'New group';
    byId('group-dialog-subtitle').textContent = group
      ? 'Everyone in it will see the new name.'
      : 'You can invite people once it exists.';
    byId('group-submit').textContent = group ? 'Save' : 'Make the group';

    dom.groupName.value = group ? group.name : '';
    setError(dom.groupForm, 'group-name', '');
    dom.groupDialog.showModal();
    dom.groupName.focus();
  }

  function submitGroup(event) {
    event.preventDefault();
    setError(dom.groupForm, 'group-name', '');

    var name = dom.groupName.value;
    var checked = groups.validateName(name);
    if (!checked.ok) return setError(dom.groupForm, 'group-name', checked.error);

    var button = byId('group-submit');
    button.disabled = true;

    var done = renamingId
      ? groups.rename(renamingId, name).then(function (result) {
          if (result.ok) ui.toast('Renamed.');
          return result;
        })
      : groups.create(name).then(function (result) {
          if (result.ok) {
            openId = result.group.id;
            ui.toast('Group made. Invite somebody into it.');
          }
          return result;
        });

    done.then(function (result) {
      button.disabled = false;
      if (!result.ok) return setError(dom.groupForm, 'group-name', result.error);
      dom.groupDialog.close();
      render();
    }).catch(function (error) {
      button.disabled = false;
      fail('Could not save the group.', error);
    });
  }

  /* ---------- the entry dialog --------------------------------------------- */

  function buildCategories() {
    /* Built the same way as the personal picker, so one stylesheet dresses
       both and they cannot drift apart. */
    dom.entryCats.innerHTML = data.categoriesForPicker().map(function (category) {
      return '<label class="cat-option" style="--dot: ' + category.color + '">' +
        '<input type="radio" name="entry-category" value="' + esc(category.id) + '">' +
        '<span>' + esc(category.label) + '</span>' +
      '</label>';
    }).join('');
  }

  function pickedCategory() {
    var chosen = dom.entryCats.querySelector('input:checked');
    return chosen ? chosen.value : '';
  }

  function openEntryDialog(groupId, entryId) {
    editingEntry = entryId || null;
    var entry = entryId ? groups.findEntry(entryId) : null;
    var group = groups.find(groupId);

    byId('entry-dialog-title').textContent = entry ? 'Correct the entry' : 'Add to the group';
    byId('entry-dialog-subtitle').textContent = entry
      ? 'Only you can change what you wrote.'
      : 'Everyone in ' + (group ? group.name : 'the group') + ' will see this.';
    byId('entry-submit').textContent = entry ? 'Save' : 'Add it';

    clearErrors(dom.entryForm);
    dom.entryAmount.value = entry ? entry.amount.toFixed(2) : '';
    dom.entryDate.value = entry ? entry.date : data.today();
    dom.entryDate.max = data.today();
    dom.entryDate.min = data.oldestDate();
    dom.entryComment.value = entry ? entry.comment : '';

    Array.prototype.forEach.call(dom.entryCats.querySelectorAll('input'), function (input) {
      input.checked = !!entry && input.value === entry.category;
    });

    countComment();
    ui.showSymbol();
    dom.entryDialog.showModal();
    dom.entryAmount.focus();
  }

  function countComment() {
    var used = dom.entryComment.value.length;
    var limit = data.MAX_COMMENT;
    dom.entryCount.textContent = used + ' / ' + limit;
    dom.entryCount.dataset.state = used >= limit ? 'full'
      : (used >= limit - 20 ? 'near' : '');
  }

  function submitEntry(event) {
    event.preventDefault();
    clearErrors(dom.entryForm);

    var input = {
      amount: dom.entryAmount.value,
      category: pickedCategory(),
      date: dom.entryDate.value,
      comment: dom.entryComment.value
    };

    var button = byId('entry-submit');
    button.disabled = true;

    var done = editingEntry
      ? groups.update(editingEntry, input)
      : groups.add(openId, input);

    done.then(function (result) {
      button.disabled = false;
      if (!result.ok) {
        Object.keys(result.errors).forEach(function (field) {
          setError(dom.entryForm, field, result.errors[field]);
        });
        return;
      }
      dom.entryDialog.close();
      render();
      ui.toast(editingEntry ? 'Entry corrected.' : 'Added to the group.');
    }).catch(function (error) {
      button.disabled = false;
      fail('Could not save that.', error);
    });
  }

  /* ---------- copying a personal expense across ---------------------------- */

  function openCopyDialog(txId) {
    var tx = data.find(txId);
    if (!tx) return;

    var mine = groups.all();
    if (!mine.length) {
      return ui.toast('You are not in a group yet. Make one on the Groups tab.');
    }

    copying = tx;

    var already = groups.copiesOf(tx.id);
    var category = data.categoryById(tx.category);

    byId('copy-dialog-subtitle').textContent =
      (category ? category.label : tx.category) + ' · ' + ui.money(tx.amount, tx.currency);

    dom.copyPick.innerHTML = mine.map(function (group) {
      var done = already.indexOf(group.id) !== -1;
      return '<label class="pick__option' + (done ? ' pick__option--done' : '') + '">' +
        '<input type="radio" name="copy-group" value="' + esc(group.id) + '"' +
          (done ? ' disabled' : '') + ' />' +
        '<span><b>' + esc(group.name) + '</b>' +
          (done ? '<i>already copied there</i>' : '<i>' + count(group.people, 'person', 'people') + '</i>') +
        '</span>' +
      '</label>';
    }).join('');

    setError(dom.copyForm, 'group', '');
    dom.copyDialog.showModal();
  }

  function submitCopy(event) {
    event.preventDefault();
    setError(dom.copyForm, 'group', '');

    var chosen = dom.copyPick.querySelector('input:checked');
    if (!chosen) return setError(dom.copyForm, 'group', 'Pick a group.');
    if (!copying) return dom.copyDialog.close();

    var button = byId('copy-submit');
    button.disabled = true;

    groups.copy(chosen.value, copying).then(function () {
      button.disabled = false;
      dom.copyDialog.close();
      copying = null;
      render();
      if (NS.dashboard) NS.dashboard.refresh();
      ui.toast('Copied. Your own expense is untouched.');
    }).catch(function (error) {
      button.disabled = false;
      fail('Could not copy it.', error);
    });
  }

  /* ---------- little form helpers ------------------------------------------ */

  function setError(form, field, message) {
    var box = form.querySelector('[data-field="' + field + '"]');
    if (!box) return;
    box.classList.toggle('field--invalid', !!message);
    var line = box.querySelector('.field__error');
    if (line) line.textContent = message || '';
  }

  function clearErrors(form) {
    Array.prototype.forEach.call(form.querySelectorAll('[data-field]'), function (box) {
      box.classList.remove('field--invalid');
      var line = box.querySelector('.field__error');
      if (line) line.textContent = '';
    });
  }

  /* ---------- doing things ------------------------------------------------- */

  function accept(groupId) {
    groups.accept(groupId).then(function () {
      openId = groupId;
      render();
      ui.toast('You are in.');
    }).catch(function (error) { fail('Could not join.', error); });
  }

  function decline(groupId) {
    groups.decline(groupId).then(function () {
      render();
      ui.toast('Turned down.');
    }).catch(function (error) { fail('Could not answer that.', error); });
  }

  function leave(groupId) {
    var group = groups.find(groupId);
    if (!group) return;
    if (!window.confirm('Leave ' + group.name + '?\n\nWhat you put in stays in the group, ' +
        'and you stop seeing it. Your own expenses are not affected.')) return;

    groups.leave(groupId).then(function () {
      openId = null;
      render();
      ui.toast('You left ' + group.name + '.');
    }).catch(function (error) { fail('Could not leave.', error); });
  }

  function removeMember(userId) {
    var group = groups.find(openId);
    if (!group) return;
    var who = groups.usernameOf(userId);
    if (!window.confirm('Remove ' + who + ' from ' + group.name + '?\n\n' +
        'What they put in stays — the totals do not change.')) return;

    groups.removeMember(openId, userId).then(function () {
      render();
      ui.toast(who + ' is out of the group.');
    }).catch(function (error) { fail('Could not remove them.', error); });
  }

  function deleteGroup(groupId) {
    var group = groups.find(groupId);
    if (!group) return;
    if (!window.confirm('Delete ' + group.name + '?\n\nEverything written inside it goes ' +
        'too, for everybody. Nobody\'s personal expenses are touched — what is in here ' +
        'are copies.')) return;

    groups.remove(groupId).then(function () {
      openId = null;
      render();
      ui.toast(group.name + ' is gone.');
    }).catch(function (error) { fail('Could not delete it.', error); });
  }

  function invite(groupId) {
    var field = dom.view.querySelector('[data-invite-field]');
    if (!field) return;

    var name = field.value.trim();
    if (!name) { field.focus(); return; }

    groups.invite(groupId, name).then(function (result) {
      if (!result.ok) return ui.toast(result.error, { duration: 7000 });
      render();
      ui.toast('Asked. It is waiting on them now.');
    }).catch(function (error) { fail('Could not invite them.', error); });
  }

  function removeEntry(entryId) {
    var entry = groups.findEntry(entryId);
    if (!entry) return;
    if (!window.confirm('Delete this entry from the group?\n\n' +
        'If it was a copy, the expense in your own list stays where it is.')) return;

    groups.removeEntry(entryId).then(function () {
      render();
      if (NS.dashboard) NS.dashboard.refresh();
      ui.toast('Entry deleted.');
    }).catch(function (error) { fail('Could not delete it.', error); });
  }

  function sendComment(entryId) {
    var field = dom.view.querySelector('[data-comment-field="' + entryId + '"]');
    if (!field) return;

    var body = field.value;
    if (!body.trim()) { field.focus(); return; }

    groups.comment(entryId, body).then(function (result) {
      if (!result.ok) return ui.toast(result.error);
      render();
      var fresh = dom.view.querySelector('[data-comment-field="' + entryId + '"]');
      if (fresh) fresh.focus();
    }).catch(function (error) { fail('Could not post that.', error); });
  }

  function removeComment(commentId) {
    groups.removeComment(commentId).then(render)
      .catch(function (error) { fail('Could not delete the comment.', error); });
  }

  /* ---------- wiring -------------------------------------------------------- */

  function wire() {
    if (wired) return;
    wired = true;

    dom.tabPersonal.addEventListener('click', function () { goToTab('personal'); });
    dom.tabGroups.addEventListener('click', function () { goToTab('groups'); });
    window.addEventListener('hashchange', function () { showTab(tabFromHash()); });

    /* One listener for the whole tab: everything in it is redrawn on every
       change, so wiring each button would mean wiring them all again. */
    dom.view.addEventListener('click', function (event) {
      var hit = function (name) {
        var node = event.target.closest('[data-' + name + ']');
        return node ? (node.dataset[name.replace(/-(.)/g, function (m, c) {
          return c.toUpperCase();
        })] || true) : null;
      };

      if (event.target.closest('[data-new-group]')) return openGroupDialog(null);
      if (event.target.closest('[data-back]')) { openId = null; openThread = null; return render(); }

      var open = hit('open');
      if (open) { openId = open; openThread = null; return render(); }

      var accepted = hit('accept');       if (accepted) return accept(accepted);
      var declined = hit('decline');      if (declined) return decline(declined);
      var left = hit('leave');            if (left) return leave(left);
      var renamed = hit('rename');        if (renamed) return openGroupDialog(renamed);
      var dropped = hit('delete-group');  if (dropped) return deleteGroup(dropped);
      var invited = hit('invite');        if (invited) return invite(invited);
      var kicked = hit('remove-member');  if (kicked) return removeMember(kicked);
      var adding = hit('add-entry');      if (adding) return openEntryDialog(adding, null);
      var edited = hit('edit-entry');     if (edited) return openEntryDialog(openId, edited);
      var erased = hit('remove-entry');   if (erased) return removeEntry(erased);
      var sent = hit('send-comment');     if (sent) return sendComment(sent);
      var unsaid = hit('remove-comment'); if (unsaid) return removeComment(unsaid);

      var thread = hit('thread');
      if (thread) {
        openThread = openThread === thread ? null : thread;
        render();
        var field = dom.view.querySelector('[data-comment-field="' + thread + '"]');
        if (field) field.focus();
      }
    });

    /* Enter sends, in both of the small fields that live inside the list. */
    dom.view.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;

      var comment = event.target.closest('[data-comment-field]');
      if (comment) { event.preventDefault(); return sendComment(comment.dataset.commentField); }

      if (event.target.closest('[data-invite-field]') && openId) {
        event.preventDefault();
        invite(openId);
      }
    });

    /* The copy button lives on the personal list, which js/dashboard.js draws.
       Listening here keeps everything about groups in this file. */
    var txList = byId('tx-groups');
    if (txList) {
      txList.addEventListener('click', function (event) {
        var node = event.target.closest('[data-copy]');
        if (node) openCopyDialog(node.dataset.copy);
      });
    }

    dom.groupForm.addEventListener('submit', submitGroup);
    dom.entryForm.addEventListener('submit', submitEntry);
    dom.copyForm.addEventListener('submit', submitCopy);
    dom.entryComment.addEventListener('input', countComment);

    Array.prototype.forEach.call(document.querySelectorAll('[data-dismiss]'), function (button) {
      button.addEventListener('click', function () {
        var box = button.closest('dialog');
        if (box) box.close();
      });
    });

    [dom.groupDialog, dom.entryDialog, dom.copyDialog].forEach(function (box) {
      box.addEventListener('click', function (event) {
        if (event.target === box) box.close();
      });
    });
  }

  /* ---------- start -------------------------------------------------------- */

  function start() {
    dom = {
      tabPersonal: byId('tab-personal'),
      tabGroups: byId('tab-groups'),
      badge: byId('tab-groups-badge'),
      panelPersonal: byId('panel-personal'),
      panelGroups: byId('panel-groups'),
      view: byId('groups-view'),
      groupDialog: byId('group-dialog'),
      groupForm: byId('group-form'),
      groupName: byId('field-group-name'),
      entryDialog: byId('entry-dialog'),
      entryForm: byId('entry-form'),
      entryCats: byId('entry-category-grid'),
      entryAmount: byId('entry-amount'),
      entryDate: byId('entry-date'),
      entryComment: byId('entry-comment'),
      entryCount: byId('entry-comment-count'),
      copyDialog: byId('copy-dialog'),
      copyForm: byId('copy-form'),
      copyPick: byId('copy-pick')
    };

    if (!dom.view) return;

    buildCategories();
    wire();
    showTab(tabFromHash());
    render();
  }

  /* js/dashboard.js is the one that waits for the account and loads the data;
     it calls this once both are in. */
  NS.groupBoard = { start: start, refresh: render };
})(window.MyMon);
