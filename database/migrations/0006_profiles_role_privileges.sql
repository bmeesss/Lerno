-- A valid OAuth (or website) access token can call Supabase/PostgREST directly.
-- RLS profiles_update_own from 0002 restricts the *row*, not the columns:
-- without column privileges a user can set their own role to 'admin', which
-- the backend then trusts for service-role moderation. Restrict both updates
-- and inserts at the SQL privilege boundary. The auth.users signup trigger
-- runs as its trusted owner; admin role changes use the service-role client.
-- Apply before enabling OAuth clients in a Supabase project.

revoke update, insert on table public.profiles from public, anon, authenticated;
grant update (display_name, avatar_url, timezone, updated_at)
  on table public.profiles to authenticated;

-- Profiles are created by handle_new_user() only. Direct inserts with role
-- 'admin' must not be possible even if a profile is absent for an auth user.
drop policy if exists "profiles_insert_own" on public.profiles;

-- Admin policies call is_admin() as SECURITY DEFINER. A valid OAuth token for
-- an admin user is still a third-party client token; it must never acquire
-- database-wide moderation access. Website admin sessions have no client_id.
-- Backend requireAdmin also rejects OAuth-client JWTs before using service role.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select auth.jwt() ->> 'client_id' is null and exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;
