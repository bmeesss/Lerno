-- RLS production fixes (Master Build DEEL 11).
--
-- Two flows that work in the in-memory backend fail against Supabase RLS:
--
-- 1. Filing a report. reports.create issues INSERT … RETURNING, but the
--    reporter has no SELECT policy (admins only), so the RETURNING clause
--    is rejected with 403. Fix: reporters may read their own reports.
--
-- 2. Guest/visitor quiz generation on public sets. Cached quiz questions are
--    regenerated on read when empty (DELETE + INSERT). The DELETE policy
--    requires set ownership and the INSERT policy requires an authenticated
--    user, so guests and non-owners get 403 on public sets. Fix: anyone may
--    rewrite questions of a *public* set's quiz. This is safe because
--    questions are a deterministic, regenerable cache of public card content
--    (no user data): vandalism is wiped by the next regeneration, quiz rows
--    and attempts are untouched, and quiz loads are rate-limited. Private
--    sets stay owner-only.

-- 1. Reporters can read their own reports ------------------------------------

create policy "reports_select_own" on public.reports
  for select using (reporter_id = auth.uid());

-- 2a. Question cleanup for public-set quizzes --------------------------------

drop policy if exists "quiz_questions_delete_set_owner" on public.quiz_questions;

create policy "quiz_questions_delete_visible" on public.quiz_questions
  for delete using (
    exists (
      select 1 from public.quizzes q
      join public.study_sets s on s.id = q.set_id
      where q.id = quiz_questions.quiz_id
        and (s.visibility = 'public' or s.owner_id = auth.uid())
    )
  );

-- 2b. Question generation for public-set quizzes (including guests) ----------

drop policy if exists "quiz_questions_insert_authenticated" on public.quiz_questions;

create policy "quiz_questions_insert_visible" on public.quiz_questions
  for insert with check (
    exists (
      select 1 from public.quizzes q
      join public.study_sets s on s.id = q.set_id
      where q.id = quiz_questions.quiz_id
        and (
          s.visibility = 'public'
          or (auth.uid() is not null and s.owner_id = auth.uid())
        )
    )
  );
