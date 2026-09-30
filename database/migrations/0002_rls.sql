-- Row-level security (spec §13). Every table is protected; the backend also
-- performs explicit authorization checks (defense in depth).
--
-- Re-runnable: "enable row level security" is already idempotent and every
-- policy is written as "drop policy if exists" + "create policy", so running
-- this file again leaves exactly the same policy set behind (Postgres has no
-- "create policy if not exists"). The definitions themselves are unchanged.

-- Admin helper: SECURITY DEFINER so policies can consult profiles.role without
-- tripping over profiles' own RLS (avoids recursive policy evaluation).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- profiles ------------------------------------------------------------------
-- Users can read/update their own profile. Display name, avatar and public
-- sets are intentionally readable by anyone (public profile page, author
-- names on shared sets — spec §6 "Profile: minimal profile information").

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- subjects ------------------------------------------------------------------

alter table public.subjects enable row level security;

drop policy if exists "subjects_owner_all" on public.subjects;
create policy "subjects_owner_all" on public.subjects
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- study_sets ----------------------------------------------------------------
-- Public sets are readable by anyone (including guests); private sets only by
-- their owner. Writes are owner-only.

alter table public.study_sets enable row level security;

drop policy if exists "sets_select_visible" on public.study_sets;
create policy "sets_select_visible" on public.study_sets
  for select using (visibility = 'public' or owner_id = auth.uid());

drop policy if exists "sets_insert_own" on public.study_sets;
create policy "sets_insert_own" on public.study_sets
  for insert with check (owner_id = auth.uid());

drop policy if exists "sets_update_own" on public.study_sets;
create policy "sets_update_own" on public.study_sets
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "sets_delete_own" on public.study_sets;
create policy "sets_delete_own" on public.study_sets
  for delete using (owner_id = auth.uid());

-- cards ---------------------------------------------------------------------
-- Readable with their parent set; writable only by the parent set's owner.

alter table public.cards enable row level security;

drop policy if exists "cards_select_with_set" on public.cards;
create policy "cards_select_with_set" on public.cards
  for select using (
    exists (
      select 1 from public.study_sets s
      where s.id = cards.set_id
        and (s.visibility = 'public' or s.owner_id = auth.uid())
    )
  );

drop policy if exists "cards_write_set_owner" on public.cards;
create policy "cards_write_set_owner" on public.cards
  for all using (
    exists (
      select 1 from public.study_sets s
      where s.id = cards.set_id and s.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.study_sets s
      where s.id = cards.set_id and s.owner_id = auth.uid()
    )
  );

-- card_progress -------------------------------------------------------------
-- Users can only modify their own progress.

alter table public.card_progress enable row level security;

drop policy if exists "progress_own_all" on public.card_progress;
create policy "progress_own_all" on public.card_progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- quizzes / quiz_questions --------------------------------------------------
-- Quizzes follow their parent set's visibility. They are generated from set
-- content (which is readable with the set), so read access matches the set.

alter table public.quizzes enable row level security;

drop policy if exists "quizzes_select_with_set" on public.quizzes;
create policy "quizzes_select_with_set" on public.quizzes
  for select using (
    exists (
      select 1 from public.study_sets s
      where s.id = quizzes.set_id
        and (s.visibility = 'public' or s.owner_id = auth.uid())
    )
  );

drop policy if exists "quizzes_insert_with_set" on public.quizzes;
create policy "quizzes_insert_with_set" on public.quizzes
  for insert with check (
    exists (
      select 1 from public.study_sets s
      where s.id = quizzes.set_id
        and (s.visibility = 'public' or s.owner_id = auth.uid())
    )
  );

drop policy if exists "quizzes_delete_set_owner" on public.quizzes;
create policy "quizzes_delete_set_owner" on public.quizzes
  for delete using (
    exists (
      select 1 from public.study_sets s
      where s.id = quizzes.set_id and s.owner_id = auth.uid()
    )
  );

alter table public.quiz_questions enable row level security;

drop policy if exists "quiz_questions_select_with_quiz" on public.quiz_questions;
create policy "quiz_questions_select_with_quiz" on public.quiz_questions
  for select using (
    exists (
      select 1 from public.quizzes q
      join public.study_sets s on s.id = q.set_id
      where q.id = quiz_questions.quiz_id
        and (s.visibility = 'public' or s.owner_id = auth.uid())
    )
  );

-- Superseded by "quiz_questions_insert_visible" in 0005 (guests may generate
-- questions for public sets). It is recreated here so this file keeps its own
-- meaning when it is run on its own; 0005 removes it again, so the end state of
-- the full chain is unchanged.
drop policy if exists "quiz_questions_insert_authenticated" on public.quiz_questions;
create policy "quiz_questions_insert_authenticated" on public.quiz_questions
  for insert with check (
    auth.uid() is not null and
    exists (
      select 1 from public.quizzes q
      join public.study_sets s on s.id = q.set_id
      where q.id = quiz_questions.quiz_id
        and (s.visibility = 'public' or s.owner_id = auth.uid())
    )
  );

-- quiz_attempts -------------------------------------------------------------

alter table public.quiz_attempts enable row level security;

drop policy if exists "attempts_own_all" on public.quiz_attempts;
create policy "attempts_own_all" on public.quiz_attempts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- study_sessions ------------------------------------------------------------

alter table public.study_sessions enable row level security;

drop policy if exists "sessions_own_all" on public.study_sessions;
create policy "sessions_own_all" on public.study_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- favorites -----------------------------------------------------------------

alter table public.favorites enable row level security;

drop policy if exists "favorites_own_all" on public.favorites;
create policy "favorites_own_all" on public.favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- reports -------------------------------------------------------------------
-- Created by authenticated users; only admins can read or manage them.

alter table public.reports enable row level security;

drop policy if exists "reports_create_authenticated" on public.reports;
create policy "reports_create_authenticated" on public.reports
  for insert with check (auth.uid() is not null and reporter_id = auth.uid());

drop policy if exists "reports_admin_all" on public.reports;
create policy "reports_admin_all" on public.reports
  for all using (public.is_admin()) with check (public.is_admin());
