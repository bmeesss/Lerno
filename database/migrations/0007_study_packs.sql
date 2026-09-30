-- Study Packs — the study-first layer on top of study_sets/cards.
--
-- Design rules (see docs/PRODUCT_DIRECTION.md and the Study Pack PR):
--   1. Purely additive. Nothing in study_sets/cards is renamed, moved or
--      deleted, so every existing set keeps working exactly as before.
--   2. A Study Pack optionally links one classic study_sets row
--      (`legacy_set_id`) that keeps holding flashcards, progress and quizzes.
--   3. Every piece of generated content can be traced back to the source it
--      came from (provenance), and to the concept it belongs to.
--   4. Publisher/method columns exist for future *official* school-method
--      integrations only. No copyrighted book content is ever scraped here.
--
-- Re-runnable: tables and indexes use "if not exists", triggers and the
-- deferred foreign key are created only when they are missing, and both
-- backfills below are guarded (the packs one by the unique legacy_set_id, the
-- sources one by an explicit "not exists"). Re-running only ever *adds* the
-- packs/sources that are genuinely missing; it never rewrites or removes a row.

-- study_packs ----------------------------------------------------------------

create table if not exists public.study_packs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  subject_name text,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  level text not null default '',
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  exam_date date,
  summary text,
  summary_source_id uuid,
  summary_updated_at timestamptz,
  -- Compatibility bridge to the classic set/card model.
  legacy_set_id uuid unique references public.study_sets (id) on delete set null,
  owns_legacy_set boolean not null default false,
  -- Reserved for official/licensed school-method integrations (metadata only).
  publisher text,
  method text,
  method_edition text,
  method_chapter text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $lerno$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'study_packs_set_updated_at'
      and tgrelid = to_regclass('public.study_packs')
      and not tgisinternal
  ) then
    create trigger study_packs_set_updated_at
      before update on public.study_packs
      for each row execute function public.set_updated_at();
  end if;
end
$lerno$;

create index if not exists study_packs_owner_idx on public.study_packs (owner_id);
create index if not exists study_packs_subject_idx on public.study_packs (subject_id);
create index if not exists study_packs_exam_idx on public.study_packs (owner_id, exam_date);

-- study_pack_sources ---------------------------------------------------------
-- One row per piece of material: pasted text, PDF, an existing Lerno set, and
-- (future) PowerPoint/YouTube/image/audio sources. `status` models the
-- asynchronous pipeline the UI already renders.

create table if not exists public.study_pack_sources (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.study_packs (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('text', 'pdf', 'set', 'powerpoint', 'youtube', 'image', 'audio')),
  title text not null check (char_length(title) between 1 and 160),
  status text not null default 'ready' check (status in ('uploading', 'processing', 'ready', 'failed')),
  content text,
  character_count integer not null default 0,
  page_count integer,
  failure_reason text,
  legacy_set_id uuid references public.study_sets (id) on delete set null,
  origin text not null default 'user' check (origin in ('user', 'ai', 'imported')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $lerno$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'study_pack_sources_set_updated_at'
      and tgrelid = to_regclass('public.study_pack_sources')
      and not tgisinternal
  ) then
    create trigger study_pack_sources_set_updated_at
      before update on public.study_pack_sources
      for each row execute function public.set_updated_at();
  end if;
end
$lerno$;

create index if not exists study_pack_sources_pack_idx on public.study_pack_sources (pack_id, created_at);

-- concepts -------------------------------------------------------------------

create table if not exists public.concepts (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.study_packs (id) on delete cascade,
  source_id uuid references public.study_pack_sources (id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  explanation text not null default '',
  origin text not null default 'user' check (origin in ('user', 'ai', 'imported')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $lerno$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'concepts_set_updated_at'
      and tgrelid = to_regclass('public.concepts')
      and not tgisinternal
  ) then
    create trigger concepts_set_updated_at
      before update on public.concepts
      for each row execute function public.set_updated_at();
  end if;
end
$lerno$;

create index if not exists concepts_pack_idx on public.concepts (pack_id, position);

-- concept_mastery ------------------------------------------------------------
-- Per-user mastery (0..1) of one concept. Feeds weak-topic detection, review
-- prioritisation and — later — adaptive learning.

create table if not exists public.concept_mastery (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  concept_id uuid not null references public.concepts (id) on delete cascade,
  mastery numeric not null default 0 check (mastery >= 0 and mastery <= 1),
  attempts integer not null default 0,
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  last_practiced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, concept_id)
);

do $lerno$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'concept_mastery_set_updated_at'
      and tgrelid = to_regclass('public.concept_mastery')
      and not tgisinternal
  ) then
    create trigger concept_mastery_set_updated_at
      before update on public.concept_mastery
      for each row execute function public.set_updated_at();
  end if;
end
$lerno$;

create index if not exists concept_mastery_user_idx on public.concept_mastery (user_id);

-- practice_questions ---------------------------------------------------------

create table if not exists public.practice_questions (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.study_packs (id) on delete cascade,
  concept_id uuid references public.concepts (id) on delete set null,
  source_id uuid references public.study_pack_sources (id) on delete set null,
  prompt text not null check (char_length(prompt) between 1 and 2000),
  question_type text not null check (question_type in ('multiple_choice', 'true_false', 'short_answer')),
  correct_answer text not null,
  options jsonb,
  explanation text not null default '',
  origin text not null default 'user' check (origin in ('user', 'ai', 'imported')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $lerno$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'practice_questions_set_updated_at'
      and tgrelid = to_regclass('public.practice_questions')
      and not tgisinternal
  ) then
    create trigger practice_questions_set_updated_at
      before update on public.practice_questions
      for each row execute function public.set_updated_at();
  end if;
end
$lerno$;

create index if not exists practice_questions_pack_idx on public.practice_questions (pack_id, position);

-- practice_attempts ----------------------------------------------------------
-- Every graded practice answer. Weak concepts are derived from these rows.

create table if not exists public.practice_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack_id uuid not null references public.study_packs (id) on delete cascade,
  question_id uuid not null references public.practice_questions (id) on delete cascade,
  concept_id uuid references public.concepts (id) on delete set null,
  answer text not null default '',
  verdict text not null check (verdict in ('correct', 'partial', 'incorrect')),
  created_at timestamptz not null default now()
);

create index if not exists practice_attempts_user_pack_idx on public.practice_attempts (user_id, pack_id, created_at);

-- tests / test_questions / test_attempts -------------------------------------

create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.study_packs (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default 'Practice test',
  mode text not null default 'quick10' check (mode in ('quick10', 'quick20', 'exam')),
  question_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists tests_pack_idx on public.tests (pack_id, created_at);

create table if not exists public.test_questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests (id) on delete cascade,
  question_id uuid not null references public.practice_questions (id) on delete cascade,
  position integer not null default 0
);

create index if not exists test_questions_test_idx on public.test_questions (test_id, position);

create table if not exists public.test_attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests (id) on delete cascade,
  pack_id uuid not null references public.study_packs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  score numeric not null default 0,
  total integer not null default 0,
  correct_count integer not null default 0,
  partial_count integer not null default 0,
  incorrect_count integer not null default 0,
  answers jsonb not null default '[]'::jsonb,
  strong_concept_ids uuid[] not null default '{}',
  weak_concept_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists test_attempts_user_pack_idx on public.test_attempts (user_id, pack_id, created_at);

-- study_plans ----------------------------------------------------------------
-- One (replaceable) study plan per pack, generated from the exam date.

create table if not exists public.study_plans (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null unique references public.study_packs (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  exam_date date,
  overview text not null default '',
  sessions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $lerno$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'study_plans_set_updated_at'
      and tgrelid = to_regclass('public.study_plans')
      and not tgisinternal
  ) then
    create trigger study_plans_set_updated_at
      before update on public.study_plans
      for each row execute function public.set_updated_at();
  end if;
end
$lerno$;

-- Provenance on cards --------------------------------------------------------
-- Nullable additions: classic set/card flows leave both columns empty, so
-- nothing in the existing product changes.

alter table public.cards
  add column if not exists source_id uuid references public.study_pack_sources (id) on delete set null,
  add column if not exists concept_id uuid references public.concepts (id) on delete set null;

create index if not exists cards_concept_idx on public.cards (concept_id);

-- summary provenance (added after study_pack_sources exists) ------------------
-- The foreign key is only created when it is missing: an existing, identical
-- constraint is left alone (and is not validated again).

do $lerno$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'study_packs_summary_source_fk'
      and conrelid = to_regclass('public.study_packs')
  ) then
    alter table public.study_packs
      add constraint study_packs_summary_source_fk
      foreign key (summary_source_id) references public.study_pack_sources (id) on delete set null;
  end if;
end
$lerno$;

-- Backfill: every existing study set becomes a Study Pack --------------------
-- Non-destructive and idempotent: the pack links the existing set, so all
-- cards, progress, quizzes and sessions stay exactly where they are.

insert into public.study_packs (
  owner_id, subject_id, subject_name, title, description, level, visibility,
  legacy_set_id, owns_legacy_set, created_at, updated_at
)
select
  s.owner_id, s.subject_id, s.subject_name, s.title, s.description, s.level, s.visibility,
  s.id, false, s.created_at, s.updated_at
from public.study_sets s
on conflict (legacy_set_id) do nothing;

insert into public.study_pack_sources (
  pack_id, owner_id, kind, title, status, character_count, legacy_set_id, origin,
  created_at, updated_at
)
select
  p.id, p.owner_id, 'set', s.title, 'ready',
  coalesce((select sum(char_length(c.question) + char_length(c.answer)) from public.cards c where c.set_id = s.id), 0),
  s.id, 'imported', p.created_at, p.updated_at
from public.study_packs p
join public.study_sets s on s.id = p.legacy_set_id
where not exists (
  select 1 from public.study_pack_sources src
  where src.legacy_set_id = s.id and src.pack_id = p.id
);
