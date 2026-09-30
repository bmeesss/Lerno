-- Adaptive learning: retain the existing concept_mastery row as the single
-- source of truth, while adding explainable confidence/due scheduling and an
-- append-only event ledger shared by every study mode.
--
-- Re-runnable: the columns are only added when they are missing and the
-- backfill runs in the same (atomic) block as the column creation, so it can
-- never run twice. That matters: 0.5 is also a legitimate confidence value the
-- app itself writes (it starts there and moves in steps of 0.01), so a plain
-- "where confidence = 0.5" backfill would overwrite real study progress on a
-- second run. Every row that exists while the column is added still holds the
-- untouched default, which is exactly the set the backfill is meant for.

do $lerno$
declare
  confidence_added boolean := false;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'concept_mastery'
      and column_name = 'confidence'
  ) then
    alter table public.concept_mastery
      add column confidence numeric not null default 0.5
        check (confidence >= 0 and confidence <= 1);
    confidence_added := true;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'concept_mastery'
      and column_name = 'next_review_at'
  ) then
    alter table public.concept_mastery
      add column next_review_at timestamptz;
  end if;

  -- Give previously studied concepts a confidence estimate grounded in their
  -- actual outcomes. Untouched concepts keep the neutral 0.5 default.
  if confidence_added then
    update public.concept_mastery
    set confidence = case
      when attempts > 0 then greatest(0, least(1, correct_count::numeric / attempts))
      else 0.5
    end
    where confidence = 0.5;
  end if;
end
$lerno$;

create index if not exists concept_mastery_user_due_idx
  on public.concept_mastery (user_id, next_review_at);

create table if not exists public.learning_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack_id uuid references public.study_packs (id) on delete cascade,
  concept_id uuid references public.concepts (id) on delete set null,
  card_id uuid references public.cards (id) on delete set null,
  question_id uuid references public.practice_questions (id) on delete set null,
  event_type text not null check (event_type in ('learn', 'flashcard', 'practice', 'test', 'review', 'self_rating')),
  is_correct boolean,
  response_time_ms integer check (response_time_ms is null or response_time_ms >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists learning_events_user_created_idx
  on public.learning_events (user_id, created_at desc);
create index if not exists learning_events_user_pack_created_idx
  on public.learning_events (user_id, pack_id, created_at desc);
create index if not exists learning_events_user_concept_created_idx
  on public.learning_events (user_id, concept_id, created_at desc);

alter table public.learning_events enable row level security;

drop policy if exists "learning_events_own_all" on public.learning_events;
create policy "learning_events_own_all" on public.learning_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
