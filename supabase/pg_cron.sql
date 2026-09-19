-- ============================================================================
-- Cadence webapp — scheduler via Supabase pg_cron  (RECOMMENDED)
--
-- Why this rather than Vercel Cron: Vercel's Hobby plan runs cron jobs at most
-- ONCE PER DAY, which cannot hit an 08:45 and a 19:30 slot. pg_cron runs every
-- minute on any Supabase plan including the free one, so a post goes out within
-- a minute of its slot.
--
-- Setup:
--   1. Dashboard → Database → Extensions → enable `pg_cron` and `pg_net`.
--   2. Replace the two placeholders below.
--   3. Run this file in the SQL editor.
--
-- To check it later:  select * from cron.job;
--                     select * from cron.job_run_details order by start_time desc limit 20;
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Keep the secrets in Vault rather than inline in a cron command that every
-- database viewer can read.
select vault.create_secret(
  'https://YOUR-APP.vercel.app',           -- ← your deployed webapp origin, no trailing slash
  'cadence_app_url',
  'Cadence webapp base URL'
) where not exists (select 1 from vault.decrypted_secrets where name = 'cadence_app_url');

select vault.create_secret(
  'YOUR_CRON_SECRET',                      -- ← same value as CRON_SECRET in the webapp env
  'cadence_cron_secret',
  'Bearer token for the Cadence publish endpoint'
) where not exists (select 1 from vault.decrypted_secrets where name = 'cadence_cron_secret');

create or replace function run_cadence_publisher() returns void as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'cadence_app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cadence_cron_secret';

  perform net.http_post(
    url     := v_url || '/api/cron/publish',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_secret
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end $$ language plpgsql;

-- Every minute. The endpoint is a no-op when nothing is due, so this is cheap.
select cron.unschedule('cadence-publish') where exists (
  select 1 from cron.job where jobname = 'cadence-publish'
);
select cron.schedule('cadence-publish', '* * * * *', 'select run_cadence_publisher()');

-- Every 10 minutes, free any post left stuck in 'publishing' by a worker that
-- died mid-run.
select cron.unschedule('cadence-release-locks') where exists (
  select 1 from cron.job where jobname = 'cadence-release-locks'
);
select cron.schedule('cadence-release-locks', '*/10 * * * *', 'select release_stale_locks(15)');
