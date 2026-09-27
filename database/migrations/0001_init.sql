-- Lerno initial schema (spec §12).
-- Run against the Supabase Postgres database (SQL editor or psql).
-- The database lives outside Git and outside Render's filesystem.

create extension if not exists "pgcrypto";

-- Shared updated_at trigger -------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- profiles ------------------------------------------------------------------
-- One row per auth user (spec §12). `role` supports the admin moderation area.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile whenever an auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- subjects ------------------------------------------------------------------

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger subjects_set_updated_at
  before update on public.subjects
  for each row execute function public.set_updated_at();

create index subjects_owner_idx on public.subjects (owner_id);

-- study_sets ----------------------------------------------------------------
-- subject_name is denormalized for display + public discovery filters; the
-- backend keeps it in sync with subjects.name.

create table public.study_sets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  subject_name text,
  title text not null check (char_length(title) between 1 and 160),
  slug text not null unique,
  description text not null default '',
  level text not null default '',
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger study_sets_set_updated_at
  before update on public.study_sets
  for each row execute function public.set_updated_at();

create index study_sets_owner_idx on public.study_sets (owner_id);
create index study_sets_visibility_idx on public.study_sets (visibility);
create index study_sets_subject_idx on public.study_sets (subject_id);
create index study_sets_tags_idx on public.study_sets using gin (tags);

-- cards ---------------------------------------------------------------------

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.study_sets (id) on delete cascade,
  question text not null check (char_length(question) between 1 and 2000),
  answer text not null check (char_length(answer) between 1 and 4000),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger cards_set_updated_at
  before update on public.cards
  for each row execute function public.set_updated_at();

create index cards_set_idx on public.cards (set_id, position);

-- card_progress -------------------------------------------------------------
-- Spaced-repetition state per (user, card) — spec §7.

create table public.card_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete cascade,
  repetition_count integer not null default 0,
  ease numeric,
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, card_id)
);

create trigger card_progress_set_updated_at
  before update on public.card_progress
  for each row execute function public.set_updated_at();

create index card_progress_user_due_idx on public.card_progress (user_id, next_review_at);

-- quizzes / quiz_questions --------------------------------------------------

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.study_sets (id) on delete cascade,
  title text not null default 'Quiz',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger quizzes_set_updated_at
  before update on public.quizzes
  for each row execute function public.set_updated_at();

create index quizzes_set_idx on public.quizzes (set_id);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  prompt text not null,
  question_type text not null check (question_type in ('multiple_choice', 'true_false', 'short_answer')),
  correct_answer text not null,
  options jsonb,
  position integer not null default 0
);

create index quiz_questions_quiz_idx on public.quiz_questions (quiz_id, position);

-- quiz_attempts -------------------------------------------------------------

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  score integer not null default 0,
  total integer not null default 0,
  created_at timestamptz not null default now()
);

create index quiz_attempts_user_idx on public.quiz_attempts (user_id, created_at);

-- study_sessions ------------------------------------------------------------
-- Guest sessions are not persisted server-side (user_id nullable only for
-- future, explicitly-safe analytics — spec §12).

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  set_id uuid references public.study_sets (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  cards_seen integer not null default 0
);

create index study_sessions_user_idx on public.study_sessions (user_id, started_at);

-- favorites -----------------------------------------------------------------

create table public.favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  set_id uuid not null references public.study_sets (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, set_id)
);

-- reports -------------------------------------------------------------------

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('study_set', 'card', 'profile')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 120),
  details text,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);

create index reports_status_idx on public.reports (status, created_at);
