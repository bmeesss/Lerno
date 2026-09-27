-- Profile timezone for user-local calendar days (Master Build DEEL 5).
--
-- Streaks, daily goals and weekly summaries group activity by calendar day.
-- Users live in timezones, so the profile carries an IANA timezone name
-- (validated server-side with Intl). Default 'UTC' preserves the exact
-- pre-migration behavior for every existing row.
--
-- Backwards-safe: additive nullable-equivalent column (NOT NULL with a
-- default backfills existing rows); no existing queries change shape; the
-- repository falls back to 'UTC' when the column is absent.

alter table public.profiles
  add column if not exists timezone text not null default 'UTC';

comment on column public.profiles.timezone is
  'IANA timezone for user-local streak/goal/week calendar days (default UTC).';
