/* MyMon — connection settings.
   Both values below are meant to be public: they ship inside every browser that
   opens the site, and on their own they grant nothing. What actually protects
   the data is the Row Level Security in supabase/migrations/.

   Never put the "service_role" key here. That one bypasses every rule. */
window.MyMon = window.MyMon || {};

window.MyMon.config = {
  /* Supabase → Project Settings → Data API → Project URL.
     Just the project address: the library adds /rest/v1 and /auth/v1 itself. */
  supabaseUrl: 'https://vhktvysiknrgulxltxqr.supabase.co',

  /* Supabase → Project Settings → API Keys → the public one
     (named "anon public", or "publishable" on newer projects) */
  supabaseKey: 'sb_publishable_obDbA80Nd7EubJSeJf2d1w_zDno5Lc4'
};
