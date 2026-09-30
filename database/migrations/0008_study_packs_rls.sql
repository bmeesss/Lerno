-- Row-level security for the Study Pack tables (defense in depth: the backend
-- also re-checks ownership/visibility on every request).
--
-- Visibility rules mirror the existing study_sets model exactly:
--   * a pack (and everything inside it) is readable by its owner, and by anyone
--     when the pack is public;
--   * learning state (mastery, attempts) is always private to the student.
--
-- Re-runnable: every policy is dropped before it is created, so running this
-- file again leaves exactly the same policy set behind (Postgres has no
-- "create policy if not exists"). The definitions themselves are unchanged.

alter table public.study_packs enable row level security;

drop policy if exists "packs_select_visible" on public.study_packs;
create policy "packs_select_visible" on public.study_packs
  for select using (visibility = 'public' or owner_id = auth.uid());

drop policy if exists "packs_insert_own" on public.study_packs;
create policy "packs_insert_own" on public.study_packs
  for insert with check (owner_id = auth.uid());

drop policy if exists "packs_update_own" on public.study_packs;
create policy "packs_update_own" on public.study_packs
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "packs_delete_own" on public.study_packs;
create policy "packs_delete_own" on public.study_packs
  for delete using (owner_id = auth.uid());

-- study_pack_sources ---------------------------------------------------------

alter table public.study_pack_sources enable row level security;

drop policy if exists "pack_sources_select_with_pack" on public.study_pack_sources;
create policy "pack_sources_select_with_pack" on public.study_pack_sources
  for select using (
    exists (
      select 1 from public.study_packs p
      where p.id = study_pack_sources.pack_id
        and (p.visibility = 'public' or p.owner_id = auth.uid())
    )
  );

drop policy if exists "pack_sources_write_owner" on public.study_pack_sources;
create policy "pack_sources_write_owner" on public.study_pack_sources
  for all using (
    exists (
      select 1 from public.study_packs p
      where p.id = study_pack_sources.pack_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.study_packs p
      where p.id = study_pack_sources.pack_id and p.owner_id = auth.uid()
    )
  );

-- concepts -------------------------------------------------------------------

alter table public.concepts enable row level security;

drop policy if exists "concepts_select_with_pack" on public.concepts;
create policy "concepts_select_with_pack" on public.concepts
  for select using (
    exists (
      select 1 from public.study_packs p
      where p.id = concepts.pack_id
        and (p.visibility = 'public' or p.owner_id = auth.uid())
    )
  );

drop policy if exists "concepts_write_owner" on public.concepts;
create policy "concepts_write_owner" on public.concepts
  for all using (
    exists (
      select 1 from public.study_packs p
      where p.id = concepts.pack_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.study_packs p
      where p.id = concepts.pack_id and p.owner_id = auth.uid()
    )
  );

-- concept_mastery ------------------------------------------------------------

alter table public.concept_mastery enable row level security;

drop policy if exists "concept_mastery_own_all" on public.concept_mastery;
create policy "concept_mastery_own_all" on public.concept_mastery
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- practice_questions ---------------------------------------------------------

alter table public.practice_questions enable row level security;

drop policy if exists "practice_questions_select_with_pack" on public.practice_questions;
create policy "practice_questions_select_with_pack" on public.practice_questions
  for select using (
    exists (
      select 1 from public.study_packs p
      where p.id = practice_questions.pack_id
        and (p.visibility = 'public' or p.owner_id = auth.uid())
    )
  );

drop policy if exists "practice_questions_write_owner" on public.practice_questions;
create policy "practice_questions_write_owner" on public.practice_questions
  for all using (
    exists (
      select 1 from public.study_packs p
      where p.id = practice_questions.pack_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.study_packs p
      where p.id = practice_questions.pack_id and p.owner_id = auth.uid()
    )
  );

-- practice_attempts ----------------------------------------------------------

alter table public.practice_attempts enable row level security;

drop policy if exists "practice_attempts_own_all" on public.practice_attempts;
create policy "practice_attempts_own_all" on public.practice_attempts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- tests / test_questions / test_attempts -------------------------------------

alter table public.tests enable row level security;

drop policy if exists "tests_select_with_pack" on public.tests;
create policy "tests_select_with_pack" on public.tests
  for select using (
    exists (
      select 1 from public.study_packs p
      where p.id = tests.pack_id
        and (p.visibility = 'public' or p.owner_id = auth.uid())
    )
  );

drop policy if exists "tests_write_owner" on public.tests;
create policy "tests_write_owner" on public.tests
  for all using (
    exists (
      select 1 from public.study_packs p
      where p.id = tests.pack_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.study_packs p
      where p.id = tests.pack_id and p.owner_id = auth.uid()
    )
  );

alter table public.test_questions enable row level security;

drop policy if exists "test_questions_select_with_pack" on public.test_questions;
create policy "test_questions_select_with_pack" on public.test_questions
  for select using (
    exists (
      select 1 from public.tests t
      join public.study_packs p on p.id = t.pack_id
      where t.id = test_questions.test_id
        and (p.visibility = 'public' or p.owner_id = auth.uid())
    )
  );

drop policy if exists "test_questions_write_owner" on public.test_questions;
create policy "test_questions_write_owner" on public.test_questions
  for all using (
    exists (
      select 1 from public.tests t
      join public.study_packs p on p.id = t.pack_id
      where t.id = test_questions.test_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.tests t
      join public.study_packs p on p.id = t.pack_id
      where t.id = test_questions.test_id and p.owner_id = auth.uid()
    )
  );

alter table public.test_attempts enable row level security;

drop policy if exists "test_attempts_own_all" on public.test_attempts;
create policy "test_attempts_own_all" on public.test_attempts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- study_plans ----------------------------------------------------------------

alter table public.study_plans enable row level security;

drop policy if exists "study_plans_select_with_pack" on public.study_plans;
create policy "study_plans_select_with_pack" on public.study_plans
  for select using (
    exists (
      select 1 from public.study_packs p
      where p.id = study_plans.pack_id
        and (p.visibility = 'public' or p.owner_id = auth.uid())
    )
  );

drop policy if exists "study_plans_write_owner" on public.study_plans;
create policy "study_plans_write_owner" on public.study_plans
  for all using (
    exists (
      select 1 from public.study_packs p
      where p.id = study_plans.pack_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.study_packs p
      where p.id = study_plans.pack_id and p.owner_id = auth.uid()
    )
  );
