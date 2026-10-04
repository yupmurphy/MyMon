/* MyMon — the public half of an account.
   A username is the name other people will eventually find you by, so unlike
   the display name it has to be unique. That uniqueness is enforced by the
   database (see supabase/migrations/); the rules below are only here to give
   a clear answer before a round trip. */
window.MyMon = window.MyMon || {};

(function (NS) {
  'use strict';

  var TABLE = 'profiles';
  var MIN = 3;
  var MAX = 20;

  function table() {
    var client = NS.session && NS.session.client;
    if (!client) throw new Error('MyMon is not connected to the database.');
    return client.from(TABLE);
  }

  /* Mirrors the check constraint on the profiles table, in words a person can
     act on.
     Returns { ok, error, value } with value always lowercased and trimmed. */
  function validate(candidate) {
    var value = String(candidate == null ? '' : candidate).trim().toLowerCase();

    if (!value) {
      return { ok: false, error: 'Pick a username.', value: value };
    }
    if (value.length < MIN) {
      return { ok: false, error: 'At least ' + MIN + ' characters.', value: value };
    }
    if (value.length > MAX) {
      return { ok: false, error: 'At most ' + MAX + ' characters.', value: value };
    }
    if (!/^[a-z]/.test(value)) {
      return { ok: false, error: 'It has to start with a letter.', value: value };
    }
    if (!/^[a-z][a-z0-9_]*$/.test(value)) {
      return { ok: false, error: 'Letters, numbers and underscores only.', value: value };
    }

    return { ok: true, error: null, value: value };
  }

  /* Your own row, or null when you have not picked a name yet. */
  function load() {
    return table()
      .select('username, first_name, last_name, created_at, ' +
              'notify_group_invite, notify_group_comment, notify_comment_on_mine, ' +
              'notify_friend')
      .maybeSingle()
      .then(function (response) {
        if (response.error) throw response.error;
        return response.data || null;
      });
  }

  /* The display name, copied onto the profile so the people in your groups can
     read it — the account's own copy is readable by nobody but you, which is
     fine until a group wants to print "Ana Popescu" instead of "@ana".

     An update rather than an upsert: with no username there is no profile row,
     and no row is the right answer, because without a username you cannot be
     invited into a group and nobody has anything to read. Picking a username
     later carries the name along with it (see save below). */
  function saveName(firstName, lastName) {
    var user = NS.session.get();
    if (!user) return Promise.resolve(null);

    return table()
      .update({
        first_name: trimmed(firstName),
        last_name: trimmed(lastName)
      })
      .eq('id', user.id)
      .then(function (response) {
        if (response.error) throw response.error;
        return true;
      });
  }

  /* Empty means empty, not an empty string: the column is allowed to be null
     and "no name" should read the same way everywhere. */
  function trimmed(value) {
    var text = String(value == null ? '' : value).trim().slice(0, 40);
    return text || null;
  }

  /* ---------- what rings the bell --------------------------------------- */

  /* The three switches on the Settings page. They live on the profile rather
     than in this browser because the triggers that send a notification are
     the ones that have to read them — a preference kept on the device would
     be invisible to the database, and the notification would be made anyway.

     Takes a patch, not all three: turning one off should not rewrite the
     other two with whatever the page happened to think they were. */
  function saveNotify(patch) {
    var user = NS.session.get();
    if (!user) return Promise.resolve(null);

    return table()
      .update(patch)
      .eq('id', user.id)
      .then(function (response) {
        if (response.error) throw response.error;
        return true;
      });
  }

  /* ---------- the first time someone signs in --------------------------- */

  /* Google hands over one string — "Victor Luca" — and never the two halves
     separately, whatever it is asked for. Rather than guess where the seam is
     and be wrong about anyone with two given names, the guess is only ever a
     suggestion typed into a field the person then corrects. */
  function splitName(fullName) {
    var parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { first: '', last: '' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  }

  /* A name squeezed into something a username is allowed to be: lowercase,
     no accents, letters and digits only, starting with a letter. */
  function slug(value) {
    var text = String(value || '').toLowerCase();
    if (text.normalize) {
      text = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
    }
    return text.replace(/[^a-z0-9]/g, '').replace(/^[^a-z]+/, '').slice(0, 14);
  }

  /* A username to start from, never one to be stuck with: it is put in a field
     the person can rewrite before anything is saved. The bare name is tried
     first because that is the one worth having; digits are only added when
     somebody already has it. */
  function suggest(fullName) {
    var stem = slug(fullName);
    if (stem.length < MIN) stem = 'mymon';

    return tryName(stem, 0);

    function tryName(candidate, attempt) {
      if (attempt > 4) return Promise.resolve(candidate);

      return isAvailable(candidate)
        .then(function (free) {
          if (free) return candidate;
          var digits = String(Math.floor(Math.random() * 9000) + 1000);
          return tryName(stem.slice(0, 20 - digits.length) + digits, attempt + 1);
        })
        .catch(function () { return candidate; });
    }
  }

  /* Everything the welcome page collects, written in one go. The account gets
     the name as well as the profile: the account's copy is what greets you
     before any profile has been fetched, and it is what a fresh install reads
     first. */
  function saveSetup(firstName, lastName, candidate) {
    var checked = validate(candidate);
    if (!checked.ok) return Promise.resolve({ ok: false, error: checked.error });

    var first = String(firstName == null ? '' : firstName).trim();
    if (!first) {
      return Promise.resolve({ ok: false, error: 'Tell MyMon your first name.', field: 'first' });
    }

    return NS.session.updateName(first, lastName)
      .then(function () { return save(candidate); })
      .then(function (result) {
        if (!result.ok) return result;
        return saveName(first, lastName).then(function () { return result; });
      });
  }

  /* The gate in front of the app. Somebody signing in for the first time has
     no profile row at all: no username, so nobody can invite them anywhere,
     and no name, so a group would have nothing to call them. They fill it in
     once and never see this again.

     Resolves true to carry on, false when the page is already on its way
     somewhere else. A database that cannot answer resolves true as well —
     being unable to check is no reason to lock somebody out of their own
     expenses. */
  function requireSetup() {
    return load()
      .then(function (row) {
        if (row && row.username && row.first_name) return true;
        window.location.replace('welcome.html');
        return false;
      })
      .catch(function (error) {
        if (window.console) {
          window.console.warn('profile: ' + (error && error.message));
        }
        return true;
      });
  }

  /* Asks the database whether a name is free. It answers yes or no and gives
     away nothing else — no list of usernames, no hint of who exists. */
  function isAvailable(candidate) {
    var checked = validate(candidate);
    if (!checked.ok) return Promise.resolve(false);

    var client = NS.session.client;
    return client.rpc('username_available', { candidate: checked.value })
      .then(function (response) {
        if (response.error) throw response.error;
        return response.data === true;
      });
  }

  /* Claims the name, or reports that someone got there first. Two people can
     still ask for the same name at the same moment, so the unique constraint
     has the final word and that refusal is translated here. */
  function save(candidate) {
    var checked = validate(candidate);
    if (!checked.ok) return Promise.resolve({ ok: false, error: checked.error });

    var user = NS.session.get();
    if (!user) return Promise.reject(new Error('You are not signed in.'));

    /* The name goes in with it. Claiming a username is what creates the row
       for somebody who typed their name first, and leaving it out here would
       mean their groups showed "@ana" until they went back and re-saved a name
       that was already on the screen. */
    return table()
      .upsert({
        id: user.id,
        username: checked.value,
        first_name: trimmed(user.firstName),
        last_name: trimmed(user.lastName)
      }, { onConflict: 'id' })
      .select('username')
      .single()
      .then(function (response) {
        if (response.error) {
          if (response.error.code === '23505') {
            return { ok: false, error: 'That username is already taken.' };
          }
          if (response.error.code === '23514') {
            return { ok: false, error: 'Letters, numbers and underscores only, starting with a letter.' };
          }
          throw response.error;
        }
        return { ok: true, username: response.data.username };
      });
  }

  NS.profile = {
    MIN: MIN,
    MAX: MAX,
    validate: validate,
    load: load,
    isAvailable: isAvailable,
    save: save,
    saveName: saveName,
    saveNotify: saveNotify,
    splitName: splitName,
    suggest: suggest,
    saveSetup: saveSetup,
    requireSetup: requireSetup
  };
})(window.MyMon);
