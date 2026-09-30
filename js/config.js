/* MyMon — connection settings.
   Both values below are meant to be public: they ship inside every browser that
   opens the site, and on their own they grant nothing. What actually protects
   the data is the Row Level Security in supabase/schema.sql.

   Never put the "service_role" key here. That one bypasses every rule. */
window.MyMon = window.MyMon || {};

window.MyMon.config = {
  /* Supabase → Project Settings → Data API → Project URL */
  supabaseUrl: 'PASTE_PROJECT_URL_HERE',

  /* Supabase → Project Settings → API Keys → the public one
     (named "anon public", or "publishable" on newer projects) */
  supabaseKey: 'PASTE_PUBLIC_KEY_HERE'
};
