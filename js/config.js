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
  supabaseKey: 'sb_publishable_obDbA80Nd7EubJSeJf2d1w_zDno5Lc4',

  /* The public half of the project's VAPID key pair — the one a browser needs
     in order to subscribe to notifications. Public by design, like the two
     above: it only lets a browser say "send to me", never "send to them".

     Its private half is a real secret. It lives in Supabase, as a secret of
     the function that does the sending, and must never appear in this file or
     anywhere else in this repository.

     Empty until the pair is made, and MyMon copes: every notification control
     reports "not set up yet" rather than offering a button that cannot work. */
  vapidPublicKey: 'BAPfSx6z020v2CVApZT1BTysxLGQblECYdTHEj13b-BFLzik8bXGJ_vb_fc-lB3f6L4J5n445fujiKYCTLsS1X8'
};
