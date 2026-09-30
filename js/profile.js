/* MyMon — the public half of an account.
   A username is the name other people will eventually find you by, so unlike
   the display name it has to be unique. That uniqueness is enforced by the
   database (see supabase/profiles.sql); the rules below are only here to give
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

  /* Mirrors the check constraint in profiles.sql, in words a person can act on.
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
      .select('username, created_at')
      .maybeSingle()
      .then(function (response) {
        if (response.error) throw response.error;
        return response.data || null;
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

    return table()
      .upsert({ id: user.id, username: checked.value }, { onConflict: 'id' })
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
    save: save
  };
})(window.MyMon);
