/* MyMon — groups: the data layer.

   The same shape as js/data.js. Everything you are allowed to see is fetched
   once when the Groups tab is first opened and kept in memory, so switching
   between groups, counting a total or opening a thread of comments stays
   instant. Only the calls that change something wait for the server.

   None of the reads below carry a filter saying "mine". They do not need one:
   the database answers every one of these with only the rows this account may
   see, and that is the single place that decision is made. A filter here would
   be a second opinion about security, written in the one place an attacker can
   edit — see supabase/migrations/20261001145917_groups_and_comments.sql. */
window.MyMon = window.MyMon || {};

(function (NS) {
  'use strict';

  var MAX_NAME = 40;
  var MAX_COMMENT = 280;

  /* Everything the account can see, as it came back. */
  var cache = {
    groups: [],      /* { id, name, ownerId, createdAt }                     */
    members: [],     /* { groupId, userId, state, invitedAt }                */
    entries: [],     /* { id, groupId, userId, amount, currency, ... }       */
    comments: []     /* { id, entryId, authorId, body, createdAt }           */
  };

  var names = {};    /* userId -> username, for everyone in a group with me  */
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

  /* ---------- reading ----------------------------------------------------- */

  function fetchAll() {
    var c = client();
    return Promise.all([
      c.from('groups').select('id, name, owner_id, created_at'),
      c.from('group_members').select('group_id, user_id, state, invited_at'),
      c.from('group_expenses')
        .select('id, group_id, user_id, amount, currency, category, spent_on, comment, copied_from, created_at')
        .order('spent_on', { ascending: false }),
      c.from('group_comments')
        .select('id, group_expense_id, author_id, body, created_at')
        .order('created_at', { ascending: true }),
      c.from('profiles').select('id, username, first_name, last_name')
    ]);
  }

  function load() {
    return fetchAll().then(function (responses) {
      responses.forEach(function (response) {
        if (response.error) throw response.error;
      });

      cache.groups = (responses[0].data || []).map(function (row) {
        return { id: row.id, name: row.name, ownerId: row.owner_id, createdAt: row.created_at };
      });

      cache.members = (responses[1].data || []).map(function (row) {
        return {
          groupId: row.group_id, userId: row.user_id,
          state: row.state, invitedAt: row.invited_at
        };
      });

      cache.entries = (responses[2].data || []).map(entryFromRow);

      cache.comments = (responses[3].data || []).map(function (row) {
        return {
          id: row.id, entryId: row.group_expense_id, authorId: row.author_id,
          body: row.body, createdAt: row.created_at
        };
      });

      names = {};
      (responses[4].data || []).forEach(function (row) {
        names[row.id] = {
          username: row.username,
          firstName: row.first_name || '',
          lastName: row.last_name || ''
        };
      });

      sortEntries();
      loaded = true;
      return true;
    });
  }

  function isLoaded() { return loaded; }

  /* A group entry is the same shape the rest of the app already speaks about
     an expense, plus who wrote it and where it came from. */
  function entryFromRow(row) {
    return {
      id: row.id,
      groupId: row.group_id,
      userId: row.user_id,
      amount: Number(row.amount),
      category: row.category,
      date: row.spent_on,
      currency: (NS.ui ? NS.ui.cleanCurrency(row.currency) : (row.currency || 'USD')),
      comment: row.comment || '',
      copiedFrom: row.copied_from,
      createdAt: row.created_at
    };
  }

  /* Newest first, ties broken by entry order — the same rule the personal list
     uses, so the two read alike. */
  function sortEntries() {
    cache.entries.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || '') < (a.createdAt || '') ? -1 : 1;
    });
  }

  /* ---------- questions about what is in memory --------------------------- */

  /* The short label a list uses: "you" for yourself, the username otherwise. */
  function usernameOf(userId) {
    if (userId === me()) return 'you';
    var row = names[userId];
    return (row && row.username) || 'someone';
  }

  /* Everything there is to say about a person, for the little card the group
     prints beside what they wrote.

     A name can be missing — it is optional, and most people never set one —
     so the username is what the card falls back to, and it is the only part
     guaranteed to exist. The initial follows whichever of the two is being
     shown, so the letter on the badge always matches the word beside it. */
  function personOf(userId) {
    var row = names[userId] || {};
    var username = row.username || '';
    var fullName = [row.firstName || '', row.lastName || ''].join(' ').trim();

    return {
      id: userId,
      isMe: userId === me(),
      username: username,
      firstName: row.firstName || '',
      lastName: row.lastName || '',
      fullName: fullName,
      /* What to print large. */
      title: fullName || (username ? '@' + username : 'Someone'),
      /* What to print small underneath, left out when it would repeat. */
      handle: username ? '@' + username : '',
      initial: (fullName || username || '?').trim().charAt(0).toUpperCase()
    };
  }

  function membersOf(groupId) {
    return cache.members.filter(function (m) { return m.groupId === groupId; });
  }

  function myStateIn(groupId) {
    var who = me();
    for (var i = 0; i < cache.members.length; i++) {
      if (cache.members[i].groupId === groupId && cache.members[i].userId === who) {
        return cache.members[i].state;
      }
    }
    return null;
  }

  function decorate(group) {
    var members = membersOf(group.id);
    return {
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      createdAt: group.createdAt,
      iOwnIt: group.ownerId === me(),
      myState: myStateIn(group.id),
      people: members.filter(function (m) { return m.state === 'member'; }).length,
      invitees: members.filter(function (m) { return m.state === 'invited'; }).length,
      entries: entriesOf(group.id).length
    };
  }

  /* The groups you are actually in, oldest first — a list that does not
     reshuffle itself every time somebody adds an expense. */
  function all() {
    return cache.groups
      .filter(function (g) { return myStateIn(g.id) === 'member'; })
      .map(decorate)
      .sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1; });
  }

  /* Invitations waiting on an answer. */
  function invitations() {
    return cache.groups
      .filter(function (g) { return myStateIn(g.id) === 'invited'; })
      .map(decorate);
  }

  function find(groupId) {
    for (var i = 0; i < cache.groups.length; i++) {
      if (cache.groups[i].id === groupId) return decorate(cache.groups[i]);
    }
    return null;
  }

  function entriesOf(groupId) {
    return cache.entries.filter(function (e) { return e.groupId === groupId; });
  }

  function findEntry(entryId) {
    for (var i = 0; i < cache.entries.length; i++) {
      if (cache.entries[i].id === entryId) return cache.entries[i];
    }
    return null;
  }

  function commentsOn(entryId) {
    return cache.comments.filter(function (c) { return c.entryId === entryId; });
  }

  /* Which of my personal expenses already have a copy somewhere, and in which
     group. What the little mark in the personal list is drawn from — and what
     stops the same expense being offered to the same group twice. */
  function copiesOf(transactionId) {
    var who = me();
    return cache.entries
      .filter(function (e) {
        return e.copiedFrom === transactionId && e.userId === who;
      })
      .map(function (e) { return e.groupId; });
  }

  /* Totals per currency, biggest first — never a sum across currencies. The
     personal side already does this; the group side borrows it rather than
     growing a second opinion about how money adds up. */
  function totalsOf(list) {
    return NS.data.totalsOf(list);
  }

  /* What each person put in, biggest first. Everyone who has an entry here
     appears, including people who have since left — their rows stayed, so
     leaving them out would make the parts not add up to the total. */
  function shares(groupId, currency) {
    var sums = {};
    var order = [];

    entriesOf(groupId).forEach(function (entry) {
      if (currency && entry.currency !== currency) return;
      if (!(entry.userId in sums)) { sums[entry.userId] = 0; order.push(entry.userId); }
      sums[entry.userId] += entry.amount;
    });

    return order.map(function (userId) {
      var person = personOf(userId);
      return {
        userId: userId,
        /* Everybody by their name, you by "you" — this list is a comparison
           against the others, and yours is the row you look for first. */
        username: person.isMe ? 'you' : person.title,
        isMe: person.isMe,
        total: Math.round(sums[userId] * 100) / 100
      };
    }).sort(function (a, b) { return b.total - a.total; });
  }

  /* ---------- making and unmaking a group --------------------------------- */

  function validateName(value) {
    var name = String(value == null ? '' : value).trim();
    if (!name) return { ok: false, error: 'Give the group a name.' };
    if (name.length > MAX_NAME) {
      return { ok: false, error: 'Keep the name under ' + MAX_NAME + ' characters.' };
    }
    return { ok: true, value: name };
  }

  function create(name) {
    var checked = validateName(name);
    if (!checked.ok) return Promise.resolve(checked);

    return client().from('groups').insert({ name: checked.value })
      .select('id, name, owner_id, created_at').single()
      .then(function (response) {
        if (response.error) throw response.error;
        var row = response.data;
        cache.groups.push({
          id: row.id, name: row.name, ownerId: row.owner_id, createdAt: row.created_at
        });
        /* The database puts the owner in the group itself, with a trigger, so
           there is no second write here that could fail on its own. Memory is
           told the same thing rather than being sent to ask. */
        cache.members.push({
          groupId: row.id, userId: me(), state: 'member', invitedAt: row.created_at
        });
        return { ok: true, group: decorate(cache.groups[cache.groups.length - 1]) };
      });
  }

  function rename(groupId, name) {
    var checked = validateName(name);
    if (!checked.ok) return Promise.resolve(checked);

    return client().from('groups').update({ name: checked.value }).eq('id', groupId)
      .then(function (response) {
        if (response.error) throw response.error;
        cache.groups.forEach(function (g) {
          if (g.id === groupId) g.name = checked.value;
        });
        return { ok: true };
      });
  }

  /* Deleting a group deletes what was written inside it and nothing else.
     Everybody's personal expenses are untouched — the copies in here were
     always copies. */
  function remove(groupId) {
    return client().from('groups').delete().eq('id', groupId)
      .then(function (response) {
        if (response.error) throw response.error;
        forget(groupId);
      });
  }

  function forget(groupId) {
    cache.groups = cache.groups.filter(function (g) { return g.id !== groupId; });
    cache.members = cache.members.filter(function (m) { return m.groupId !== groupId; });

    var gone = {};
    cache.entries.forEach(function (e) { if (e.groupId === groupId) gone[e.id] = true; });
    cache.entries = cache.entries.filter(function (e) { return e.groupId !== groupId; });
    cache.comments = cache.comments.filter(function (c) { return !gone[c.entryId]; });
  }

  /* ---------- who is in it ------------------------------------------------ */

  /* The browser never learns anybody's account id: it sends a username and
     gets back one word. */
  var INVITE_SAID = {
    invited: null,                                     /* the good ending     */
    already_in: 'They are already in this group.',
    already_invited: 'They have already been asked — it is waiting on them.',
    no_such_user: 'No account by that name. Check the spelling with them.',
    no_such_group: 'That group is gone.',
    not_owner: 'Only whoever made the group can invite people.',
    self: 'That is you.'
  };

  function invite(groupId, username) {
    /* The box already shows an @ in front, so most people will not type one.
       The ones who do are not wrong, and should not be told off for it. */
    var candidate = String(username == null ? '' : username).trim().replace(/^@+/, '').trim();
    if (!candidate) return Promise.resolve({ ok: false, error: 'Type their username.' });

    return client().rpc('invite_to_group', { gid: groupId, candidate: candidate })
      .then(function (response) {
        if (response.error) throw response.error;
        var said = response.data;
        if (said !== 'invited') {
          return { ok: false, error: INVITE_SAID[said] || 'That did not work.' };
        }
        /* The invitation exists now, but this account is not allowed to read
           the invitee's name until they accept, so memory is refreshed from
           the server rather than guessed at. */
        return load().then(function () { return { ok: true }; });
      });
  }

  function setState(groupId, userId, state) {
    return client().from('group_members').update({ state: state })
      .eq('group_id', groupId).eq('user_id', userId)
      .then(function (response) {
        if (response.error) throw response.error;
        cache.members.forEach(function (m) {
          if (m.groupId === groupId && m.userId === userId) m.state = state;
        });
      });
  }

  function accept(groupId) {
    /* Accepting opens the group up, so everything in it has to be fetched —
       until this moment the database was answering with nothing. */
    return setState(groupId, me(), 'member').then(load);
  }

  function decline(groupId) {
    return setState(groupId, me(), 'left').then(function () { forget(groupId); });
  }

  function leave(groupId) {
    return setState(groupId, me(), 'left').then(function () { forget(groupId); });
  }

  function removeMember(groupId, userId) {
    return setState(groupId, userId, 'left');
  }

  /* ---------- what is written in it --------------------------------------- */

  function keep(entry) {
    cache.entries.push(entry);
    sortEntries();
    return entry;
  }

  function toRow(groupId, value, copiedFrom) {
    return {
      group_id: groupId,
      amount: value.amount,
      category: value.category,
      spent_on: value.date,
      currency: (NS.ui ? NS.ui.cleanCurrency(value.currency) : (value.currency || 'USD')),
      comment: value.comment || '',
      copied_from: copiedFrom || null
    };
  }

  var ENTRY_SELECT =
    'id, group_id, user_id, amount, currency, category, spent_on, comment, copied_from, created_at';

  /* Written straight into the group. The same validation the personal form
     uses, so the two cannot disagree about what a sensible expense is. */
  function add(groupId, input) {
    var result = NS.data.validate(input);
    if (!result.ok) return Promise.resolve(result);

    result.value.currency = NS.ui ? NS.ui.currencyCode() : 'USD';

    return client().from('group_expenses').insert(toRow(groupId, result.value))
      .select(ENTRY_SELECT).single()
      .then(function (response) {
        if (response.error) throw response.error;
        result.entry = keep(entryFromRow(response.data));
        return result;
      });
  }

  /* A copy. The original is not read from, changed, or marked in any way —
     this writes a new row that happens to remember where it came from, and
     from here the two lead separate lives. */
  function copy(groupId, tx) {
    var value = {
      amount: tx.amount, category: tx.category,
      date: tx.date, currency: tx.currency, comment: tx.comment
    };

    return client().from('group_expenses').insert(toRow(groupId, value, tx.id))
      .select(ENTRY_SELECT).single()
      .then(function (response) {
        if (response.error) throw response.error;
        return keep(entryFromRow(response.data));
      });
  }

  function update(entryId, input) {
    var current = findEntry(entryId);
    if (!current) return Promise.reject(new Error('That entry is no longer here.'));

    var result = NS.data.validate(input);
    if (!result.ok) return Promise.resolve(result);

    /* An edit corrects what was spent, not what it was spent in. */
    result.value.currency = current.currency;

    return client().from('group_expenses')
      .update({
        amount: result.value.amount,
        category: result.value.category,
        spent_on: result.value.date,
        comment: result.value.comment || ''
      })
      .eq('id', entryId).select(ENTRY_SELECT).single()
      .then(function (response) {
        if (response.error) throw response.error;
        var fresh = entryFromRow(response.data);
        for (var i = 0; i < cache.entries.length; i++) {
          if (cache.entries[i].id === entryId) { cache.entries[i] = fresh; break; }
        }
        sortEntries();
        result.entry = fresh;
        return result;
      });
  }

  function removeEntry(entryId) {
    return client().from('group_expenses').delete().eq('id', entryId)
      .then(function (response) {
        if (response.error) throw response.error;
        cache.entries = cache.entries.filter(function (e) { return e.id !== entryId; });
        cache.comments = cache.comments.filter(function (c) { return c.entryId !== entryId; });
      });
  }

  /* ---------- comments ----------------------------------------------------- */

  function comment(entryId, body) {
    var text = String(body == null ? '' : body).trim();
    if (!text) return Promise.resolve({ ok: false, error: 'Write something first.' });
    if (text.length > MAX_COMMENT) {
      return Promise.resolve({ ok: false, error: 'Keep it under ' + MAX_COMMENT + ' characters.' });
    }

    return client().from('group_comments').insert({ group_expense_id: entryId, body: text })
      .select('id, group_expense_id, author_id, body, created_at').single()
      .then(function (response) {
        if (response.error) throw response.error;
        var row = response.data;
        cache.comments.push({
          id: row.id, entryId: row.group_expense_id, authorId: row.author_id,
          body: row.body, createdAt: row.created_at
        });
        return { ok: true };
      });
  }

  function removeComment(commentId) {
    return client().from('group_comments').delete().eq('id', commentId)
      .then(function (response) {
        if (response.error) throw response.error;
        cache.comments = cache.comments.filter(function (c) { return c.id !== commentId; });
      });
  }

  NS.groups = {
    MAX_NAME: MAX_NAME,
    MAX_COMMENT: MAX_COMMENT,
    load: load,
    isLoaded: isLoaded,
    me: me,
    all: all,
    invitations: invitations,
    find: find,
    usernameOf: usernameOf,
    personOf: personOf,
    membersOf: membersOf,
    entriesOf: entriesOf,
    findEntry: findEntry,
    commentsOn: commentsOn,
    copiesOf: copiesOf,
    totalsOf: totalsOf,
    shares: shares,
    validateName: validateName,
    create: create,
    rename: rename,
    remove: remove,
    invite: invite,
    accept: accept,
    decline: decline,
    leave: leave,
    removeMember: removeMember,
    add: add,
    copy: copy,
    update: update,
    removeEntry: removeEntry,
    comment: comment,
    removeComment: removeComment
  };
})(window.MyMon);
