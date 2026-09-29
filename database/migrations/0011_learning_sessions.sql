-- Adaptive study experience: server-side study sessions and daily mastery
-- snapshots on top of the existing adaptive engine (0009).
--
-- Additive only. Nothing here changes or duplicates an existing table:
--   * mastery lives in concept_mastery (0009) and keeps being the only mastery model,
--   * every answer is still stored as a practice_attempt / test_attempt and a
--     learning_event (sessions link to their events through metadata.sessionId),
--   * the classic flashcard timer table `study_sessions` (0001) is untouched. The
--     new sessions therefore use the `learning_` prefix, like `learning_events`.

-- learning_sessions ----------------------------------------------------------
-- One row per Learn / Practice / Review / Test session. The server owns the
-- state (status, progress, result) so a session survives a reload or a switch
-- of device and can be resumed.

create table if not exists public.learning_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack_id uuid not null references public.study_packs (id) on delete cascade,
  type text not null check (type in ('learn', 'practice', 'review', 'test')),
  status text not null default 'not_started'
    check (status in ('not_started', 'active', 'completed', 'abandoned')),
  -- Test length for type = 'test' (quick10 | quick20 | exam), null otherwise.
  mode text check (mode is null or mode in ('quick10', 'quick20', 'exam')),
  title text not null default '',
  -- The concept the student asked to focus on ("Practice this concept").
  focus_concept_id uuid references public.concepts (id) on delete set null,
  -- Concepts this session is about (ids at creation time).
  target_concept_ids uuid[] not null default '{}',
  -- A test session reuses the existing tests / test_attempts tables.
  test_id uuid references public.tests (id) on delete set null,
  item_count integer not null default 0 check (item_count >= 0),
  answered_count integer not null default 0 check (answered_count >= 0),
  current_position integer not null default 0 check (current_position >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  last_activity_at timestamptz not null default now(),
  -- Active study time in seconds (idle gaps are capped by the server).
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  -- Score, concept changes, weak concepts and the recommended next step.
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists learning_sessions_user_status_idx
  on public.learning_sessions (user_id, status, last_activity_at desc);
create index if not exists learning_sessions_user_pack_idx
  on public.learning_sessions (user_id, pack_id, created_at desc);
create index if not exists learning_sessions_user_completed_idx
  on public.learning_sessions (user_id, completed_at desc);

-- learning_session_items -----------------------------------------------------
-- The activities of a session: a concept to learn or a question to answer.

create table if not exists public.learning_session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.learning_sessions (id) on delete cascade,
  -- Denormalized owner + pack keep row-level security and the "which questions
  -- has this student already seen" lookup to a single indexed table.
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack_id uuid not null references public.study_packs (id) on delete cascade,
  position integer not null check (position >= 0),
  kind text not null check (kind in ('concept', 'question')),
  concept_id uuid references public.concepts (id) on delete set null,
  -- Question items: the question. Concept items: the short "check yourself" question.
  question_id uuid references public.practice_questions (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'answered', 'skipped')),
  answer text,
  verdict text check (verdict is null or verdict in ('correct', 'partial', 'incorrect')),
  -- Learn mode self-rating (Again / Hard / Good / Easy).
  rating text check (rating is null or rating in ('again', 'hard', 'good', 'easy')),
  mastery_before numeric check (mastery_before is null or (mastery_before >= 0 and mastery_before <= 1)),
  mastery_after numeric check (mastery_after is null or (mastery_after >= 0 and mastery_after <= 1)),
  response_time_ms integer check (response_time_ms is null or response_time_ms >= 0),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, position)
);

create index if not exists learning_session_items_session_idx
  on public.learning_session_items (session_id, position);
create index if not exists learning_session_items_user_pack_idx
  on public.learning_session_items (user_id, pack_id, answered_at desc);

-- mastery_snapshots ----------------------------------------------------------
-- One row per student, pack and local calendar day: the pack's concept-based
-- mastery at the end of that day. Only real study days get a row, so a trend
-- line is never interpolated.

create table if not exists public.mastery_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack_id uuid not null references public.study_packs (id) on delete cascade,
  day date not null,
  mastery_percent integer not null check (mastery_percent >= 0 and mastery_percent <= 100),
  concepts_total integer not null default 0 check (concepts_total >= 0),
  weak_concepts integer not null default 0 check (weak_concepts >= 0),
  mastered_concepts integer not null default 0 check (mastered_concepts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, pack_id, day)
);

create index if not exists mastery_snapshots_user_day_idx
  on public.mastery_snapshots (user_id, day desc);

-- Row-level security: sessions, items and snapshots are private to the student.
-- Inserting also requires that the pack is visible to the student, exactly like
-- the pack tables (defense in depth: the backend re-checks ownership too).

alter table public.learning_sessions enable row level security;
create policy "learning_sessions_own_select" on public.learning_sessions
  for select using (user_id = auth.uid());
create policy "learning_sessions_own_write" on public.learning_sessions
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.study_packs p
      where p.id = learning_sessions.pack_id
        and (p.visibility = 'public' or p.owner_id = auth.uid())
    )
  );

alter table public.learning_session_items enable row level security;
create policy "learning_session_items_own_select" on public.learning_session_items
  for select using (user_id = auth.uid());
create policy "learning_session_items_own_write" on public.learning_session_items
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.learning_sessions s
      where s.id = learning_session_items.session_id and s.user_id = auth.uid()
    )
  );

alter table public.mastery_snapshots enable row level security;
create policy "mastery_snapshots_own_select" on public.mastery_snapshots
  for select using (user_id = auth.uid());
create policy "mastery_snapshots_own_write" on public.mastery_snapshots
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.study_packs p
      where p.id = mastery_snapshots.pack_id
        and (p.visibility = 'public' or p.owner_id = auth.uid())
    )
  );
