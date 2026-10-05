-- MyMon — the clock that calls the sender.
--
-- The dashboard's Cron wizard writes this job with `headers := '{}'`, and the
-- function refuses that with 401 before doing anything at all. It failed
-- silently, once a minute — the worst way for a thing to be broken, because
-- nothing anywhere says so. Proven by sending exactly what the job sent:
--
--     POST /functions/v1/send-push   with no headers
--     -> 401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER"}
--
-- So the job lives here instead, in a file somebody can read, rather than in a
-- wizard's output nobody looks at twice.
--
-- About the key below
-- -------------------
-- It is the publishable one — the same string that ships inside every browser
-- that opens MyMon, and already sits in js/config.js. It is here to satisfy
-- the function's door, not to prove anything. There is no secret in this row,
-- and nothing is lost if somebody reads it.
--
-- Which means, stated plainly rather than left to be discovered: **anybody
-- holding that key can trigger this function.** What they get for it is
-- notifications delivered to the people they already belong to, a few seconds
-- early, and a reply that is three numbers. No content can be injected, and
-- nothing of anybody's can be read. The only real cost of abuse is burning the
-- monthly allowance of function calls.
--
-- That is proportionate to accept at three users. It is also on the list to
-- close the day MyMon is opened to strangers — the same trigger already
-- written down for the other deferred work. Closing it means a secret the
-- caller must present, kept in Vault rather than in this row, because a secret
-- in a row is a secret that leaves with the first careless backup.
--
-- About the timeout
-- -----------------
-- Five seconds, not the wizard's one. pg_net sends the request either way, but
-- a timeout that expires before the answer arrives throws the answer away —
-- and then nobody can tell a working run from a failing one, which is how the
-- 401 above went unnoticed in the first place.

select cron.unschedule('send-push')
 where exists (select 1 from cron.job where jobname = 'send-push');

select cron.schedule(
  'send-push',
  '* * * * *',
  $job$
  select net.http_post(
    url     := 'https://vhktvysiknrgulxltxqr.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer sb_publishable_obDbA80Nd7EubJSeJf2d1w_zDno5Lc4'
    ),
    timeout_milliseconds := 5000
  );
  $job$
);
