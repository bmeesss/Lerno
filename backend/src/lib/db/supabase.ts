/**
 * Supabase repository implementation (production data path).
 *
 * User-scoped operations run through a client bound to the caller's JWT, so
 * Postgres row-level security applies to every query (spec §13). The
 * service-role client is used only for trusted admin contexts (after the
 * backend has verified the admin role) and for auth-user administration.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../../config.js';
import type { Database } from './repository.js';
import type {
  AdminUserRecord,
  AuthUserRecord,
  CardProgressRecord,
  CardRecord,
  ConceptMasteryRecord,
  ConceptRecord,
  FavoriteRecord,
  NewCard,
  NewConcept,
  NewPracticeQuestion,
  NewQuizQuestion,
  PracticeAttemptRecord,
  PracticeQuestionRecord,
  ProfileRecord,
  ProgressUpsert,
  QuizAttemptRecord,
  QuizQuestionRecord,
  QuizRecord,
  ReportCreate,
  ReportPatch,
  ReportRecord,
  Role,
  SetFilter,
  StudyPackRecord,
  StudyPackSourceRecord,
  StudyPlanRecord,
  StudySessionCreate,
  StudySessionPatch,
  StudySessionRecord,
  StudySetRecord,
  SubjectRecord,
  TestAttemptRecord,
  TestMode,
  TestQuestionRecord,
  TestRecord,
} from './types.js';

type Row = Record<string, unknown>;

function field<T = string>(row: Row, key: string): T {
  return row[key] as T;
}

function profileRow(row: Row): ProfileRecord {
  return {
    id: field(row, 'id'),
    displayName: field<string>(row, 'display_name') ?? '',
    avatarUrl: field<string | null>(row, 'avatar_url') ?? null,
    role: (field<string>(row, 'role') ?? 'user') === 'admin' ? 'admin' : 'user',
    // Tolerant of pre-0004 databases where the column does not exist yet.
    timezone: field<string>(row, 'timezone') ?? 'UTC',
    createdAt: field(row, 'created_at'),
    updatedAt: field(row, 'updated_at'),
  };
}

function subjectRow(row: Row): SubjectRecord {
  return {
    id: field(row, 'id'),
    ownerId: field(row, 'owner_id'),
    name: field(row, 'name'),
    createdAt: field(row, 'created_at'),
    updatedAt: field(row, 'updated_at'),
  };
}

function setRow(row: Row): StudySetRecord {
  return {
    id: field(row, 'id'),
    ownerId: field(row, 'owner_id'),
    subjectId: field<string | null>(row, 'subject_id') ?? null,
    subjectName: field<string | null>(row, 'subject_name') ?? null,
    title: field(row, 'title'),
    slug: field(row, 'slug'),
    description: field<string>(row, 'description') ?? '',
    level: field<string>(row, 'level') ?? '',
    visibility: field<string>(row, 'visibility') === 'public' ? 'public' : 'private',
    tags: field<string[]>(row, 'tags') ?? [],
    createdAt: field(row, 'created_at'),
    updatedAt: field(row, 'updated_at'),
  };
}

function cardRow(row: Row): CardRecord {
  return {
    id: field(row, 'id'),
    setId: field(row, 'set_id'),
    question: field(row, 'question'),
    answer: field(row, 'answer'),
    position: field<number>(row, 'position') ?? 0,
    // Tolerant of pre-0007 databases where the provenance columns do not exist yet.
    sourceId: field<string | null>(row, 'source_id') ?? null,
    conceptId: field<string | null>(row, 'concept_id') ?? null,
    createdAt: field(row, 'created_at'),
    updatedAt: field(row, 'updated_at'),
  };
}

function progressRow(row: Row): CardProgressRecord {
  return {
    id: field(row, 'id'),
    userId: field(row, 'user_id'),
    cardId: field(row, 'card_id'),
    repetitionCount: field<number>(row, 'repetition_count') ?? 0,
    ease: field<number | null>(row, 'ease') ?? null,
    lastReviewedAt: field<string | null>(row, 'last_reviewed_at') ?? null,
    nextReviewAt: field<string | null>(row, 'next_review_at') ?? null,
    correctCount: field<number>(row, 'correct_count') ?? 0,
    incorrectCount: field<number>(row, 'incorrect_count') ?? 0,
    createdAt: field(row, 'created_at'),
    updatedAt: field(row, 'updated_at'),
  };
}

function quizRow(row: Row): QuizRecord {
  return {
    id: field(row, 'id'),
    setId: field(row, 'set_id'),
    title: field(row, 'title'),
    createdAt: field(row, 'created_at'),
    updatedAt: field(row, 'updated_at'),
  };
}

function quizQuestionRow(row: Row): QuizQuestionRecord {
  return {
    id: field(row, 'id'),
    quizId: field(row, 'quiz_id'),
    prompt: field(row, 'prompt'),
    questionType: field(row, 'question_type'),
    correctAnswer: field(row, 'correct_answer'),
    options: field<string[] | null>(row, 'options') ?? null,
    position: field<number>(row, 'position') ?? 0,
  };
}

function questionPayload(quizId: string, questions: NewQuizQuestion[]) {
  return questions.map((question) => ({
    quiz_id: quizId,
    prompt: question.prompt,
    question_type: question.questionType,
    correct_answer: question.correctAnswer,
    options: question.options,
    position: question.position,
  }));
}

function attemptRow(row: Row): QuizAttemptRecord {
  const joined = row['quizzes'] as { set_id?: string | null } | { set_id?: string | null }[] | null;
  const quiz = Array.isArray(joined) ? joined[0] : joined;
  return {
    id: field(row, 'id'),
    userId: field(row, 'user_id'),
    quizId: field(row, 'quiz_id'),
    setId: quiz?.set_id ?? null,
    score: field<number>(row, 'score') ?? 0,
    total: field<number>(row, 'total') ?? 0,
    createdAt: field(row, 'created_at'),
  };
}

function sessionRow(row: Row): StudySessionRecord {
  return {
    id: field(row, 'id'),
    userId: field<string | null>(row, 'user_id') ?? null,
    setId: field<string | null>(row, 'set_id') ?? null,
    startedAt: field(row, 'started_at'),
    endedAt: field<string | null>(row, 'ended_at') ?? null,
    cardsSeen: field<number>(row, 'cards_seen') ?? 0,
  };
}

function favoriteRow(row: Row): FavoriteRecord {
  return {
    userId: field(row, 'user_id'),
    setId: field(row, 'set_id'),
    createdAt: field(row, 'created_at'),
  };
}

function reportRow(row: Row): ReportRecord {
  return {
    id: field(row, 'id'),
    reporterId: field(row, 'reporter_id'),
    targetType: field(row, 'target_type'),
    targetId: field(row, 'target_id'),
    reason: field(row, 'reason'),
    details: field<string | null>(row, 'details') ?? null,
    status: field(row, 'status'),
    createdAt: field(row, 'created_at'),
    resolvedAt: field<string | null>(row, 'resolved_at') ?? null,
    resolvedBy: field<string | null>(row, 'resolved_by') ?? null,
  };
}

function packRow(row: Row): StudyPackRecord {
  return {
    id: field(row, 'id'),
    ownerId: field(row, 'owner_id'),
    subjectId: field<string | null>(row, 'subject_id') ?? null,
    subjectName: field<string | null>(row, 'subject_name') ?? null,
    title: field(row, 'title'),
    description: field<string>(row, 'description') ?? '',
    level: field<string>(row, 'level') ?? '',
    visibility: field<string>(row, 'visibility') === 'public' ? 'public' : 'private',
    examDate: field<string | null>(row, 'exam_date') ?? null,
    summary: field<string | null>(row, 'summary') ?? null,
    summarySourceId: field<string | null>(row, 'summary_source_id') ?? null,
    summaryUpdatedAt: field<string | null>(row, 'summary_updated_at') ?? null,
    legacySetId: field<string | null>(row, 'legacy_set_id') ?? null,
    ownsLegacySet: field<boolean>(row, 'owns_legacy_set') ?? false,
    publisher: field<string | null>(row, 'publisher') ?? null,
    method: field<string | null>(row, 'method') ?? null,
    methodEdition: field<string | null>(row, 'method_edition') ?? null,
    methodChapter: field<string | null>(row, 'method_chapter') ?? null,
    createdAt: field(row, 'created_at'),
    updatedAt: field(row, 'updated_at'),
  };
}

function packSourceRow(row: Row): StudyPackSourceRecord {
  return {
    id: field(row, 'id'),
    packId: field(row, 'pack_id'),
    ownerId: field(row, 'owner_id'),
    kind: field<string>(row, 'kind') as StudyPackSourceRecord['kind'],
    title: field(row, 'title'),
    status: field<string>(row, 'status') as StudyPackSourceRecord['status'],
    content: field<string | null>(row, 'content') ?? null,
    characterCount: field<number>(row, 'character_count') ?? 0,
    pageCount: field<number | null>(row, 'page_count') ?? null,
    failureReason: field<string | null>(row, 'failure_reason') ?? null,
    legacySetId: field<string | null>(row, 'legacy_set_id') ?? null,
    origin: field<string>(row, 'origin') as StudyPackSourceRecord['origin'],
    createdAt: field(row, 'created_at'),
    updatedAt: field(row, 'updated_at'),
  };
}

function conceptRow(row: Row): ConceptRecord {
  return {
    id: field(row, 'id'),
    packId: field(row, 'pack_id'),
    sourceId: field<string | null>(row, 'source_id') ?? null,
    name: field(row, 'name'),
    explanation: field<string>(row, 'explanation') ?? '',
    origin: field<string>(row, 'origin') as ConceptRecord['origin'],
    position: field<number>(row, 'position') ?? 0,
    createdAt: field(row, 'created_at'),
    updatedAt: field(row, 'updated_at'),
  };
}

function conceptMasteryRow(row: Row): ConceptMasteryRecord {
  return {
    id: field(row, 'id'),
    userId: field(row, 'user_id'),
    conceptId: field(row, 'concept_id'),
    mastery: Number(field<number>(row, 'mastery') ?? 0),
    attempts: field<number>(row, 'attempts') ?? 0,
    correctCount: field<number>(row, 'correct_count') ?? 0,
    incorrectCount: field<number>(row, 'incorrect_count') ?? 0,
    lastPracticedAt: field<string | null>(row, 'last_practiced_at') ?? null,
    createdAt: field(row, 'created_at'),
    updatedAt: field(row, 'updated_at'),
  };
}

function practiceQuestionRow(row: Row): PracticeQuestionRecord {
  return {
    id: field(row, 'id'),
    packId: field(row, 'pack_id'),
    conceptId: field<string | null>(row, 'concept_id') ?? null,
    sourceId: field<string | null>(row, 'source_id') ?? null,
    prompt: field(row, 'prompt'),
    questionType: field<string>(row, 'question_type') as PracticeQuestionRecord['questionType'],
    correctAnswer: field(row, 'correct_answer'),
    options: field<string[] | null>(row, 'options') ?? null,
    explanation: field<string>(row, 'explanation') ?? '',
    origin: field<string>(row, 'origin') as PracticeQuestionRecord['origin'],
    position: field<number>(row, 'position') ?? 0,
    createdAt: field(row, 'created_at'),
    updatedAt: field(row, 'updated_at'),
  };
}

function practiceAttemptRow(row: Row): PracticeAttemptRecord {
  return {
    id: field(row, 'id'),
    userId: field(row, 'user_id'),
    packId: field(row, 'pack_id'),
    questionId: field(row, 'question_id'),
    conceptId: field<string | null>(row, 'concept_id') ?? null,
    answer: field<string>(row, 'answer') ?? '',
    verdict: field<string>(row, 'verdict') as PracticeAttemptRecord['verdict'],
    createdAt: field(row, 'created_at'),
  };
}

function testRow(row: Row): TestRecord {
  return {
    id: field(row, 'id'),
    packId: field(row, 'pack_id'),
    ownerId: field(row, 'owner_id'),
    title: field(row, 'title'),
    mode: field<string>(row, 'mode') as TestMode,
    questionCount: field<number>(row, 'question_count') ?? 0,
    createdAt: field(row, 'created_at'),
  };
}

function testQuestionRow(row: Row): TestQuestionRecord {
  return {
    id: field(row, 'id'),
    testId: field(row, 'test_id'),
    questionId: field(row, 'question_id'),
    position: field<number>(row, 'position') ?? 0,
  };
}

function testAttemptRow(row: Row): TestAttemptRecord {
  return {
    id: field(row, 'id'),
    testId: field(row, 'test_id'),
    packId: field(row, 'pack_id'),
    userId: field(row, 'user_id'),
    score: Number(field<number>(row, 'score') ?? 0),
    total: field<number>(row, 'total') ?? 0,
    correctCount: field<number>(row, 'correct_count') ?? 0,
    partialCount: field<number>(row, 'partial_count') ?? 0,
    incorrectCount: field<number>(row, 'incorrect_count') ?? 0,
    answers: field<TestAttemptRecord['answers']>(row, 'answers') ?? [],
    strongConceptIds: field<string[]>(row, 'strong_concept_ids') ?? [],
    weakConceptIds: field<string[]>(row, 'weak_concept_ids') ?? [],
    createdAt: field(row, 'created_at'),
  };
}

function studyPlanRow(row: Row): StudyPlanRecord {
  return {
    id: field(row, 'id'),
    packId: field(row, 'pack_id'),
    ownerId: field(row, 'owner_id'),
    examDate: field<string | null>(row, 'exam_date') ?? null,
    overview: field<string>(row, 'overview') ?? '',
    sessions: field<StudyPlanRecord['sessions']>(row, 'sessions') ?? [],
    createdAt: field(row, 'created_at'),
    updatedAt: field(row, 'updated_at'),
  };
}

function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(`Supabase error: ${error.message}`);
}

function userClient(accessToken: string | null): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function serviceClient(): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function buildDatabase(client: SupabaseClient, admin: SupabaseClient | null): Database {
  return {
    async ping() {
      const { error } = await client.from('profiles').select('id', { head: true }).limit(1);
      throwIfError(error);
    },

    profiles: {
      async get(id) {
        const { data, error } = await client
          .from('profiles')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        throwIfError(error);
        return data ? profileRow(data as Row) : null;
      },
      async upsert(profile) {
        const payload = {
          id: profile.id,
          display_name: profile.displayName,
          avatar_url: profile.avatarUrl ?? null,
          ...(profile.role ? { role: profile.role } : {}),
          ...(profile.timezone ? { timezone: profile.timezone } : {}),
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await client
          .from('profiles')
          .upsert(payload, { onConflict: 'id' })
          .select()
          .single();
        throwIfError(error);
        return profileRow(data as Row);
      },
      async update(id, patch) {
        const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (patch.displayName !== undefined) payload['display_name'] = patch.displayName;
        if (patch.avatarUrl !== undefined) payload['avatar_url'] = patch.avatarUrl;
        if (patch.timezone !== undefined) payload['timezone'] = patch.timezone;
        const { data, error } = await client
          .from('profiles')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
        throwIfError(error);
        return profileRow(data as Row);
      },
      async count() {
        const { count, error } = await client
          .from('profiles')
          .select('id', { count: 'exact', head: true });
        throwIfError(error);
        return count ?? 0;
      },
    },

    authUsers: {
      async list(limit, offset) {
        if (!admin) throw new Error('Service-role client required for auth users');
        const page = Math.floor(offset / limit) + 1;
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: limit });
        throwIfError(error);
        const users: AuthUserRecord[] = data.users.map((user) => ({
          id: user.id,
          email: user.email ?? '',
          createdAt: user.created_at ?? new Date().toISOString(),
        }));
        const { data: profiles } = await admin
          .from('profiles')
          .select('*')
          .in(
            'id',
            users.map((u) => u.id),
          );
        const byId = new Map<string, ProfileRecord>();
        for (const row of (profiles ?? []) as Row[]) {
          const profile = profileRow(row);
          byId.set(profile.id, profile);
        }
        return users.map((user) => {
          const profile = byId.get(user.id);
          return {
            ...user,
            displayName: profile?.displayName ?? '',
            role: profile?.role ?? 'user',
          } satisfies AdminUserRecord;
        });
      },
      async count() {
        if (!admin) throw new Error('Service-role client required for auth users');
        const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
        throwIfError(error);
        return 'total' in data ? data.total : 0;
      },
      async setRole(userId, role: Role) {
        const { error } = await (admin ?? client)
          .from('profiles')
          .update({ role, updated_at: new Date().toISOString() })
          .eq('id', userId);
        throwIfError(error);
      },
      async delete(userId) {
        if (!admin) throw new Error('Service-role client required for auth users');
        const { error } = await admin.auth.admin.deleteUser(userId);
        throwIfError(error);
      },
    },

    subjects: {
      async listByOwner(ownerId) {
        const { data, error } = await client
          .from('subjects')
          .select('*')
          .eq('owner_id', ownerId)
          .order('name');
        throwIfError(error);
        return (data as Row[]).map(subjectRow);
      },
      async get(id) {
        const { data, error } = await client
          .from('subjects')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        throwIfError(error);
        return data ? subjectRow(data as Row) : null;
      },
      async create(data) {
        const payload = {
          owner_id: data.ownerId,
          name: data.name,
        };
        const { data: row, error } = await client
          .from('subjects')
          .insert(payload)
          .select()
          .single();
        throwIfError(error);
        return subjectRow(row as Row);
      },
      async update(id, patch) {
        const { data, error } = await client
          .from('subjects')
          .update({ name: patch.name, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select()
          .single();
        throwIfError(error);
        return subjectRow(data as Row);
      },
      async delete(id) {
        const { error } = await client.from('subjects').delete().eq('id', id);
        throwIfError(error);
      },
      async setCounts(subjectIds) {
        const counts: Record<string, number> = {};
        for (const id of subjectIds) counts[id] = 0;
        if (subjectIds.length === 0) return counts;
        const { data, error } = await client
          .from('study_sets')
          .select('subject_id')
          .in('subject_id', subjectIds);
        throwIfError(error);
        for (const row of (data ?? []) as Row[]) {
          const subjectId = field<string>(row, 'subject_id');
          if (subjectId && counts[subjectId] !== undefined) counts[subjectId] += 1;
        }
        return counts;
      },
      async setsReferencing(subjectId) {
        const { data, error } = await client
          .from('study_sets')
          .select('*')
          .eq('subject_id', subjectId);
        throwIfError(error);
        return (data as Row[]).map(setRow);
      },
    },

    sets: {
      async get(id) {
        const { data, error } = await client
          .from('study_sets')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        throwIfError(error);
        return data ? setRow(data as Row) : null;
      },
      async listByOwner(ownerId) {
        const { data, error } = await client
          .from('study_sets')
          .select('*')
          .eq('owner_id', ownerId)
          .order('updated_at', { ascending: false });
        throwIfError(error);
        return (data as Row[]).map(setRow);
      },
      async listByIds(ids) {
        if (ids.length === 0) return [];
        const { data, error } = await client.from('study_sets').select('*').in('id', ids);
        throwIfError(error);
        return (data as Row[]).map(setRow);
      },
      async listPublic(filter) {
        let query = client
          .from('study_sets')
          .select('*')
          .eq('visibility', 'public')
          .order('updated_at', { ascending: false })
          .range(filter.offset, filter.offset + filter.limit - 1);
        query = applySetFilters(query, filter);
        const { data, error } = await query;
        throwIfError(error);
        return (data as Row[]).map(setRow);
      },
      async countPublic(filter) {
        let query = client
          .from('study_sets')
          .select('id', { count: 'exact', head: true })
          .eq('visibility', 'public');
        query = applySetFilters(query, filter);
        const { count, error } = await query;
        throwIfError(error);
        return count ?? 0;
      },
      async listByOwnerAndSubject(ownerId, subjectId) {
        const { data, error } = await client
          .from('study_sets')
          .select('*')
          .eq('owner_id', ownerId)
          .eq('subject_id', subjectId);
        throwIfError(error);
        return (data as Row[]).map(setRow);
      },
      async listPublicByOwner(ownerId) {
        const { data, error } = await client
          .from('study_sets')
          .select('*')
          .eq('owner_id', ownerId)
          .eq('visibility', 'public');
        throwIfError(error);
        return (data as Row[]).map(setRow);
      },
      async countAll() {
        const { count, error } = await client
          .from('study_sets')
          .select('id', { count: 'exact', head: true });
        throwIfError(error);
        return count ?? 0;
      },
      async create(data) {
        const payload = {
          owner_id: data.ownerId,
          subject_id: data.subjectId,
          subject_name: data.subjectName,
          title: data.title,
          slug: data.slug,
          description: data.description,
          level: data.level,
          visibility: data.visibility,
          tags: data.tags,
        };
        const { data: row, error } = await client
          .from('study_sets')
          .insert(payload)
          .select()
          .single();
        throwIfError(error);
        return setRow(row as Row);
      },
      async update(id, patch) {
        const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (patch.subjectId !== undefined) payload['subject_id'] = patch.subjectId;
        if (patch.subjectName !== undefined) payload['subject_name'] = patch.subjectName;
        if (patch.title !== undefined) payload['title'] = patch.title;
        if (patch.slug !== undefined) payload['slug'] = patch.slug;
        if (patch.description !== undefined) payload['description'] = patch.description;
        if (patch.level !== undefined) payload['level'] = patch.level;
        if (patch.visibility !== undefined) payload['visibility'] = patch.visibility;
        if (patch.tags !== undefined) payload['tags'] = patch.tags;
        const { data, error } = await client
          .from('study_sets')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
        throwIfError(error);
        return setRow(data as Row);
      },
      async delete(id) {
        const { error } = await client.from('study_sets').delete().eq('id', id);
        throwIfError(error);
      },
    },

    cards: {
      async get(id) {
        const { data, error } = await client.from('cards').select('*').eq('id', id).maybeSingle();
        throwIfError(error);
        return data ? cardRow(data as Row) : null;
      },
      async listBySet(setId) {
        const { data, error } = await client
          .from('cards')
          .select('*')
          .eq('set_id', setId)
          .order('position');
        throwIfError(error);
        return (data as Row[]).map(cardRow);
      },
      async countBySets(setIds) {
        const counts: Record<string, number> = {};
        for (const id of setIds) counts[id] = 0;
        if (setIds.length === 0) return counts;
        const { data, error } = await client.from('cards').select('set_id').in('set_id', setIds);
        throwIfError(error);
        for (const row of (data ?? []) as Row[]) {
          const setId = field<string>(row, 'set_id');
          if (counts[setId] !== undefined) counts[setId] += 1;
        }
        return counts;
      },
      async createMany(setId, cards: NewCard[]) {
        const payload = cards.map((card) => ({
          set_id: setId,
          question: card.question,
          answer: card.answer,
          position: card.position,
          // Provenance columns only when they carry a value, so classic set
          // creation keeps working on databases without migration 0007.
          ...(card.sourceId ? { source_id: card.sourceId } : {}),
          ...(card.conceptId ? { concept_id: card.conceptId } : {}),
        }));
        const { data, error } = await client.from('cards').insert(payload).select();
        throwIfError(error);
        return (data as Row[]).map(cardRow);
      },
      async update(id, patch) {
        const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (patch.question !== undefined) payload['question'] = patch.question;
        if (patch.answer !== undefined) payload['answer'] = patch.answer;
        if (patch.position !== undefined) payload['position'] = patch.position;
        if (patch.sourceId !== undefined) payload['source_id'] = patch.sourceId;
        if (patch.conceptId !== undefined) payload['concept_id'] = patch.conceptId;
        const { data, error } = await client
          .from('cards')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
        throwIfError(error);
        return cardRow(data as Row);
      },
      async delete(id) {
        const { error } = await client.from('cards').delete().eq('id', id);
        throwIfError(error);
      },
      async deleteBySet(setId) {
        const { error } = await client.from('cards').delete().eq('set_id', setId);
        throwIfError(error);
      },
      async countAll() {
        const { count, error } = await client
          .from('cards')
          .select('id', { count: 'exact', head: true });
        throwIfError(error);
        return count ?? 0;
      },
    },

    progress: {
      async get(userId, cardId) {
        const { data, error } = await client
          .from('card_progress')
          .select('*')
          .eq('user_id', userId)
          .eq('card_id', cardId)
          .maybeSingle();
        throwIfError(error);
        return data ? progressRow(data as Row) : null;
      },
      async upsert(record: ProgressUpsert) {
        const payload = {
          user_id: record.userId,
          card_id: record.cardId,
          repetition_count: record.repetitionCount,
          ease: record.ease,
          last_reviewed_at: record.lastReviewedAt,
          next_review_at: record.nextReviewAt,
          correct_count: record.correctCount,
          incorrect_count: record.incorrectCount,
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await client
          .from('card_progress')
          .upsert(payload, { onConflict: 'user_id,card_id' })
          .select()
          .single();
        throwIfError(error);
        return progressRow(data as Row);
      },
      async listByUser(userId) {
        const { data, error } = await client
          .from('card_progress')
          .select('*')
          .eq('user_id', userId);
        throwIfError(error);
        return (data as Row[]).map(progressRow);
      },
      async listDue(userId, nowIso) {
        const { data, error } = await client
          .from('card_progress')
          .select('*')
          .eq('user_id', userId)
          .not('next_review_at', 'is', null)
          .lte('next_review_at', nowIso)
          .order('next_review_at');
        throwIfError(error);
        return (data as Row[]).map(progressRow);
      },
      async listByUserAndSet(userId, setId) {
        const { data: cards, error: cardsError } = await client
          .from('cards')
          .select('id')
          .eq('set_id', setId);
        throwIfError(cardsError);
        const cardIds = ((cards ?? []) as Row[]).map((row) => field<string>(row, 'id'));
        if (cardIds.length === 0) return [];
        const { data, error } = await client
          .from('card_progress')
          .select('*')
          .eq('user_id', userId)
          .in('card_id', cardIds);
        throwIfError(error);
        return (data as Row[]).map(progressRow);
      },
    },

    quizzes: {
      async get(quizId) {
        const { data, error } = await client
          .from('quizzes')
          .select('*')
          .eq('id', quizId)
          .maybeSingle();
        throwIfError(error);
        return data ? quizRow(data as Row) : null;
      },
      async getBySet(setId) {
        const { data, error } = await client
          .from('quizzes')
          .select('*')
          .eq('set_id', setId)
          .maybeSingle();
        throwIfError(error);
        return data ? quizRow(data as Row) : null;
      },
      async createWithQuestions(setId, title, questions: NewQuizQuestion[]) {
        const { data: quizData, error: quizError } = await client
          .from('quizzes')
          .insert({ set_id: setId, title })
          .select()
          .single();
        throwIfError(quizError);
        const quiz = quizRow(quizData as Row);
        const payload = questionPayload(quiz.id, questions);
        const { data: questionRows, error: questionError } = await client
          .from('quiz_questions')
          .insert(payload)
          .select();
        if (questionError) {
          await client.from('quizzes').delete().eq('id', quiz.id);
          throwIfError(questionError);
        }
        return {
          quiz,
          questions: ((questionRows ?? []) as Row[]).map(quizQuestionRow),
        };
      },
      async listQuestions(quizId) {
        const { data, error } = await client
          .from('quiz_questions')
          .select('*')
          .eq('quiz_id', quizId)
          .order('position');
        throwIfError(error);
        return (data as Row[]).map(quizQuestionRow);
      },
      async deleteBySet(setId) {
        const { error } = await client.from('quizzes').delete().eq('set_id', setId);
        throwIfError(error);
      },
      async deleteQuestionsBySet(setId) {
        const { data: quizzes, error: quizError } = await client
          .from('quizzes')
          .select('id')
          .eq('set_id', setId);
        throwIfError(quizError);
        const quizIds = ((quizzes ?? []) as Row[]).map((row) => field<string>(row, 'id'));
        if (quizIds.length === 0) return;
        const { error } = await client.from('quiz_questions').delete().in('quiz_id', quizIds);
        throwIfError(error);
      },
      async replaceQuestions(quizId, questions: NewQuizQuestion[]) {
        const { error: deleteError } = await client
          .from('quiz_questions')
          .delete()
          .eq('quiz_id', quizId);
        throwIfError(deleteError);
        const { data, error } = await client
          .from('quiz_questions')
          .insert(questionPayload(quizId, questions))
          .select();
        throwIfError(error);
        return ((data ?? []) as Row[]).map(quizQuestionRow);
      },
    },

    attempts: {
      async create(data) {
        const payload = {
          user_id: data.userId,
          quiz_id: data.quizId,
          score: data.score,
          total: data.total,
        };
        const { data: row, error } = await client
          .from('quiz_attempts')
          .insert(payload)
          .select('*, quizzes(set_id)')
          .single();
        throwIfError(error);
        return attemptRow(row as Row);
      },
      async listByUser(userId) {
        const { data, error } = await client
          .from('quiz_attempts')
          .select('*, quizzes(set_id)')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        throwIfError(error);
        return (data as Row[]).map(attemptRow);
      },
      async countAll() {
        const { count, error } = await client
          .from('quiz_attempts')
          .select('id', { count: 'exact', head: true });
        throwIfError(error);
        return count ?? 0;
      },
    },

    sessions: {
      async create(data: StudySessionCreate) {
        const payload = {
          user_id: data.userId,
          set_id: data.setId,
          started_at: data.startedAt,
          cards_seen: 0,
        };
        const { data: row, error } = await client
          .from('study_sessions')
          .insert(payload)
          .select()
          .single();
        throwIfError(error);
        return sessionRow(row as Row);
      },
      async update(id, patch: StudySessionPatch) {
        const payload: Record<string, unknown> = {};
        if (patch.endedAt !== undefined) payload['ended_at'] = patch.endedAt;
        if (patch.cardsSeen !== undefined) payload['cards_seen'] = patch.cardsSeen;
        const { data, error } = await client
          .from('study_sessions')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
        throwIfError(error);
        return sessionRow(data as Row);
      },
      async listByUser(userId) {
        const { data, error } = await client
          .from('study_sessions')
          .select('*')
          .eq('user_id', userId)
          .order('started_at', { ascending: false });
        throwIfError(error);
        return (data as Row[]).map(sessionRow);
      },
    },

    favorites: {
      async add(userId, setId) {
        const { error } = await client.from('favorites').upsert({ user_id: userId, set_id: setId });
        throwIfError(error);
      },
      async remove(userId, setId) {
        const { error } = await client
          .from('favorites')
          .delete()
          .eq('user_id', userId)
          .eq('set_id', setId);
        throwIfError(error);
      },
      async has(userId, setId) {
        const { data, error } = await client
          .from('favorites')
          .select('set_id')
          .eq('user_id', userId)
          .eq('set_id', setId)
          .maybeSingle();
        throwIfError(error);
        return Boolean(data);
      },
      async listByUser(userId) {
        const { data, error } = await client
          .from('favorites')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        throwIfError(error);
        return (data as Row[]).map(favoriteRow);
      },
    },

    reports: {
      async create(data: ReportCreate) {
        const payload = {
          reporter_id: data.reporterId,
          target_type: data.targetType,
          target_id: data.targetId,
          reason: data.reason,
          details: data.details,
        };
        const { data: row, error } = await client.from('reports').insert(payload).select().single();
        throwIfError(error);
        return reportRow(row as Row);
      },
      async get(id) {
        const { data, error } = await client.from('reports').select('*').eq('id', id).maybeSingle();
        throwIfError(error);
        return data ? reportRow(data as Row) : null;
      },
      async list(filter) {
        let query = client
          .from('reports')
          .select('*')
          .order('created_at', { ascending: false })
          .range(filter.offset, filter.offset + filter.limit - 1);
        if (filter.status) query = query.eq('status', filter.status);
        const { data, error } = await query;
        throwIfError(error);
        return (data as Row[]).map(reportRow);
      },
      async count(filter) {
        let query = client.from('reports').select('id', { count: 'exact', head: true });
        if (filter.status) query = query.eq('status', filter.status);
        const { count, error } = await query;
        throwIfError(error);
        return count ?? 0;
      },
      async update(id, patch: ReportPatch) {
        const payload: Record<string, unknown> = {};
        if (patch.status !== undefined) payload['status'] = patch.status;
        if (patch.resolvedAt !== undefined) payload['resolved_at'] = patch.resolvedAt;
        if (patch.resolvedBy !== undefined) payload['resolved_by'] = patch.resolvedBy;
        const { data, error } = await client
          .from('reports')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
        throwIfError(error);
        return reportRow(data as Row);
      },
      async countOpen() {
        const { count, error } = await client
          .from('reports')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'open');
        throwIfError(error);
        return count ?? 0;
      },
    },

    /* ----------------------------- study packs --------------------------- */

    packs: {
      async get(id) {
        const { data, error } = await client.from('study_packs').select('*').eq('id', id).maybeSingle();
        throwIfError(error);
        return data ? packRow(data as Row) : null;
      },
      async listByOwner(ownerId) {
        const { data, error } = await client
          .from('study_packs')
          .select('*')
          .eq('owner_id', ownerId)
          .order('updated_at', { ascending: false });
        throwIfError(error);
        return (data as Row[]).map(packRow);
      },
      async listByOwnerAndSubject(ownerId, subjectId) {
        const { data, error } = await client
          .from('study_packs')
          .select('*')
          .eq('owner_id', ownerId)
          .eq('subject_id', subjectId)
          .order('updated_at', { ascending: false });
        throwIfError(error);
        return (data as Row[]).map(packRow);
      },
      async listByIds(ids) {
        if (ids.length === 0) return [];
        const { data, error } = await client.from('study_packs').select('*').in('id', ids);
        throwIfError(error);
        return (data as Row[]).map(packRow);
      },
      async getByLegacySetId(setId) {
        const { data, error } = await client
          .from('study_packs')
          .select('*')
          .eq('legacy_set_id', setId)
          .maybeSingle();
        throwIfError(error);
        return data ? packRow(data as Row) : null;
      },
      async listUpcomingExams(ownerId, fromDay) {
        const { data, error } = await client
          .from('study_packs')
          .select('*')
          .eq('owner_id', ownerId)
          .not('exam_date', 'is', null)
          .gte('exam_date', fromDay)
          .order('exam_date', { ascending: true });
        throwIfError(error);
        return (data as Row[]).map(packRow);
      },
      async create(data) {
        const payload: Record<string, unknown> = {
          owner_id: data.ownerId,
          subject_id: data.subjectId,
          subject_name: data.subjectName,
          title: data.title,
          description: data.description,
          level: data.level,
          visibility: data.visibility,
          exam_date: data.examDate,
          legacy_set_id: data.legacySetId,
          owns_legacy_set: data.ownsLegacySet ?? false,
        };
        if (data.publisher !== undefined) payload['publisher'] = data.publisher;
        if (data.method !== undefined) payload['method'] = data.method;
        if (data.methodEdition !== undefined) payload['method_edition'] = data.methodEdition;
        if (data.methodChapter !== undefined) payload['method_chapter'] = data.methodChapter;
        const { data: row, error } = await client
          .from('study_packs')
          .insert(payload)
          .select()
          .single();
        throwIfError(error);
        return packRow(row as Row);
      },
      async update(id, patch) {
        const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (patch.subjectId !== undefined) payload['subject_id'] = patch.subjectId;
        if (patch.subjectName !== undefined) payload['subject_name'] = patch.subjectName;
        if (patch.title !== undefined) payload['title'] = patch.title;
        if (patch.description !== undefined) payload['description'] = patch.description;
        if (patch.level !== undefined) payload['level'] = patch.level;
        if (patch.visibility !== undefined) payload['visibility'] = patch.visibility;
        if (patch.examDate !== undefined) payload['exam_date'] = patch.examDate;
        if (patch.summary !== undefined) payload['summary'] = patch.summary;
        if (patch.summarySourceId !== undefined) payload['summary_source_id'] = patch.summarySourceId;
        if (patch.summaryUpdatedAt !== undefined) payload['summary_updated_at'] = patch.summaryUpdatedAt;
        if (patch.publisher !== undefined) payload['publisher'] = patch.publisher;
        if (patch.method !== undefined) payload['method'] = patch.method;
        if (patch.methodEdition !== undefined) payload['method_edition'] = patch.methodEdition;
        if (patch.methodChapter !== undefined) payload['method_chapter'] = patch.methodChapter;
        const { data, error } = await client
          .from('study_packs')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
        throwIfError(error);
        return packRow(data as Row);
      },
      async delete(id) {
        const { error } = await client.from('study_packs').delete().eq('id', id);
        throwIfError(error);
      },
    },

    packSources: {
      async get(id) {
        const { data, error } = await client
          .from('study_pack_sources')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        throwIfError(error);
        return data ? packSourceRow(data as Row) : null;
      },
      async listByPack(packId) {
        const { data, error } = await client
          .from('study_pack_sources')
          .select('*')
          .eq('pack_id', packId)
          .order('created_at', { ascending: true });
        throwIfError(error);
        return (data as Row[]).map(packSourceRow);
      },
      async countByPacks(packIds) {
        const counts: Record<string, number> = {};
        for (const id of packIds) counts[id] = 0;
        if (packIds.length === 0) return counts;
        const { data, error } = await client
          .from('study_pack_sources')
          .select('pack_id')
          .in('pack_id', packIds);
        throwIfError(error);
        for (const row of (data ?? []) as Row[]) {
          const packId = field<string>(row, 'pack_id');
          if (counts[packId] !== undefined) counts[packId] += 1;
        }
        return counts;
      },
      async create(data) {
        const payload = {
          pack_id: data.packId,
          owner_id: data.ownerId,
          kind: data.kind,
          title: data.title,
          status: data.status,
          content: data.content,
          character_count: data.characterCount,
          page_count: data.pageCount,
          failure_reason: data.failureReason,
          legacy_set_id: data.legacySetId,
          origin: data.origin,
        };
        const { data: row, error } = await client
          .from('study_pack_sources')
          .insert(payload)
          .select()
          .single();
        throwIfError(error);
        return packSourceRow(row as Row);
      },
      async update(id, patch) {
        const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (patch.title !== undefined) payload['title'] = patch.title;
        if (patch.status !== undefined) payload['status'] = patch.status;
        if (patch.content !== undefined) payload['content'] = patch.content;
        if (patch.characterCount !== undefined) payload['character_count'] = patch.characterCount;
        if (patch.pageCount !== undefined) payload['page_count'] = patch.pageCount;
        if (patch.failureReason !== undefined) payload['failure_reason'] = patch.failureReason;
        const { data, error } = await client
          .from('study_pack_sources')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
        throwIfError(error);
        return packSourceRow(data as Row);
      },
      async delete(id) {
        const { error } = await client.from('study_pack_sources').delete().eq('id', id);
        throwIfError(error);
      },
    },

    concepts: {
      async get(id) {
        const { data, error } = await client.from('concepts').select('*').eq('id', id).maybeSingle();
        throwIfError(error);
        return data ? conceptRow(data as Row) : null;
      },
      async listByPack(packId) {
        const { data, error } = await client
          .from('concepts')
          .select('*')
          .eq('pack_id', packId)
          .order('position', { ascending: true });
        throwIfError(error);
        return (data as Row[]).map(conceptRow);
      },
      async listByIds(ids) {
        if (ids.length === 0) return [];
        const { data, error } = await client.from('concepts').select('*').in('id', ids);
        throwIfError(error);
        return (data as Row[]).map(conceptRow);
      },
      async countByPacks(packIds) {
        const counts: Record<string, number> = {};
        for (const id of packIds) counts[id] = 0;
        if (packIds.length === 0) return counts;
        const { data, error } = await client.from('concepts').select('pack_id').in('pack_id', packIds);
        throwIfError(error);
        for (const row of (data ?? []) as Row[]) {
          const packId = field<string>(row, 'pack_id');
          if (counts[packId] !== undefined) counts[packId] += 1;
        }
        return counts;
      },
      async createMany(packId, concepts: NewConcept[]) {
        if (concepts.length === 0) return [];
        const payload = concepts.map((concept) => ({
          pack_id: packId,
          source_id: concept.sourceId,
          name: concept.name,
          explanation: concept.explanation,
          origin: concept.origin,
          position: concept.position,
        }));
        const { data, error } = await client.from('concepts').insert(payload).select();
        throwIfError(error);
        return (data as Row[]).map(conceptRow);
      },
      async update(id, patch) {
        const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (patch.name !== undefined) payload['name'] = patch.name;
        if (patch.explanation !== undefined) payload['explanation'] = patch.explanation;
        if (patch.position !== undefined) payload['position'] = patch.position;
        const { data, error } = await client
          .from('concepts')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
        throwIfError(error);
        return conceptRow(data as Row);
      },
      async delete(id) {
        const { error } = await client.from('concepts').delete().eq('id', id);
        throwIfError(error);
      },
      async detachFromCards(conceptId) {
        const { error } = await client
          .from('cards')
          .update({ concept_id: null })
          .eq('concept_id', conceptId);
        throwIfError(error);
      },
    },

    conceptMastery: {
      async get(userId, conceptId) {
        const { data, error } = await client
          .from('concept_mastery')
          .select('*')
          .eq('user_id', userId)
          .eq('concept_id', conceptId)
          .maybeSingle();
        throwIfError(error);
        return data ? conceptMasteryRow(data as Row) : null;
      },
      async listByUser(userId) {
        const { data, error } = await client
          .from('concept_mastery')
          .select('*')
          .eq('user_id', userId);
        throwIfError(error);
        return (data as Row[]).map(conceptMasteryRow);
      },
      async listByUserAndPack(userId, packId) {
        const { data: concepts, error: conceptError } = await client
          .from('concepts')
          .select('id')
          .eq('pack_id', packId);
        throwIfError(conceptError);
        const conceptIds = (concepts as Row[]).map((row) => field<string>(row, 'id'));
        if (conceptIds.length === 0) return [];
        const { data, error } = await client
          .from('concept_mastery')
          .select('*')
          .eq('user_id', userId)
          .in('concept_id', conceptIds);
        throwIfError(error);
        return (data as Row[]).map(conceptMasteryRow);
      },
      async upsert(record) {
        const payload = {
          user_id: record.userId,
          concept_id: record.conceptId,
          mastery: record.mastery,
          attempts: record.attempts,
          correct_count: record.correctCount,
          incorrect_count: record.incorrectCount,
          last_practiced_at: record.lastPracticedAt,
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await client
          .from('concept_mastery')
          .upsert(payload, { onConflict: 'user_id,concept_id' })
          .select()
          .single();
        throwIfError(error);
        return conceptMasteryRow(data as Row);
      },
    },

    practiceQuestions: {
      async get(id) {
        const { data, error } = await client
          .from('practice_questions')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        throwIfError(error);
        return data ? practiceQuestionRow(data as Row) : null;
      },
      async listByPack(packId) {
        const { data, error } = await client
          .from('practice_questions')
          .select('*')
          .eq('pack_id', packId)
          .order('position', { ascending: true });
        throwIfError(error);
        return (data as Row[]).map(practiceQuestionRow);
      },
      async listByIds(ids) {
        if (ids.length === 0) return [];
        const { data, error } = await client.from('practice_questions').select('*').in('id', ids);
        throwIfError(error);
        return (data as Row[]).map(practiceQuestionRow);
      },
      async countByPacks(packIds) {
        const counts: Record<string, number> = {};
        for (const id of packIds) counts[id] = 0;
        if (packIds.length === 0) return counts;
        const { data, error } = await client
          .from('practice_questions')
          .select('pack_id')
          .in('pack_id', packIds);
        throwIfError(error);
        for (const row of (data ?? []) as Row[]) {
          const packId = field<string>(row, 'pack_id');
          if (counts[packId] !== undefined) counts[packId] += 1;
        }
        return counts;
      },
      async createMany(packId, questions: NewPracticeQuestion[]) {
        if (questions.length === 0) return [];
        const payload = questions.map((question) => ({
          pack_id: packId,
          concept_id: question.conceptId,
          source_id: question.sourceId,
          prompt: question.prompt,
          question_type: question.questionType,
          correct_answer: question.correctAnswer,
          options: question.options,
          explanation: question.explanation,
          origin: question.origin,
          position: question.position,
        }));
        const { data, error } = await client.from('practice_questions').insert(payload).select();
        throwIfError(error);
        return (data as Row[]).map(practiceQuestionRow);
      },
      async update(id, patch) {
        const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (patch.prompt !== undefined) payload['prompt'] = patch.prompt;
        if (patch.questionType !== undefined) payload['question_type'] = patch.questionType;
        if (patch.correctAnswer !== undefined) payload['correct_answer'] = patch.correctAnswer;
        if (patch.options !== undefined) payload['options'] = patch.options;
        if (patch.explanation !== undefined) payload['explanation'] = patch.explanation;
        if (patch.conceptId !== undefined) payload['concept_id'] = patch.conceptId;
        const { data, error } = await client
          .from('practice_questions')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
        throwIfError(error);
        return practiceQuestionRow(data as Row);
      },
      async delete(id) {
        const { error } = await client.from('practice_questions').delete().eq('id', id);
        throwIfError(error);
      },
    },

    practiceAttempts: {
      async create(data) {
        const payload = {
          user_id: data.userId,
          pack_id: data.packId,
          question_id: data.questionId,
          concept_id: data.conceptId,
          answer: data.answer,
          verdict: data.verdict,
        };
        const { data: row, error } = await client
          .from('practice_attempts')
          .insert(payload)
          .select()
          .single();
        throwIfError(error);
        return practiceAttemptRow(row as Row);
      },
      async listByUser(userId) {
        const { data, error } = await client
          .from('practice_attempts')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(500);
        throwIfError(error);
        return (data as Row[]).map(practiceAttemptRow);
      },
      async listByUserAndPack(userId, packId) {
        const { data, error } = await client
          .from('practice_attempts')
          .select('*')
          .eq('user_id', userId)
          .eq('pack_id', packId)
          .order('created_at', { ascending: false })
          .limit(500);
        throwIfError(error);
        return (data as Row[]).map(practiceAttemptRow);
      },
    },

    tests: {
      async get(id) {
        const { data, error } = await client.from('tests').select('*').eq('id', id).maybeSingle();
        throwIfError(error);
        return data ? testRow(data as Row) : null;
      },
      async listByPack(packId) {
        const { data, error } = await client
          .from('tests')
          .select('*')
          .eq('pack_id', packId)
          .order('created_at', { ascending: false })
          .limit(50);
        throwIfError(error);
        return (data as Row[]).map(testRow);
      },
      async listByUser(userId) {
        const { data, error } = await client
          .from('tests')
          .select('*')
          .eq('owner_id', userId)
          .order('created_at', { ascending: false })
          .limit(50);
        throwIfError(error);
        return (data as Row[]).map(testRow);
      },
      async createTest(data) {
        const { data: row, error } = await client
          .from('tests')
          .insert({
            pack_id: data.packId,
            owner_id: data.ownerId,
            title: data.title,
            mode: data.mode,
            question_count: data.questionIds.length,
          })
          .select()
          .single();
        throwIfError(error);
        const test = testRow(row as Row);
        const payload = data.questionIds.map((questionId, index) => ({
          test_id: test.id,
          question_id: questionId,
          position: index,
        }));
        const { data: questionRows, error: questionError } =
          payload.length > 0
            ? await client.from('test_questions').insert(payload).select()
            : { data: [], error: null };
        throwIfError(questionError);
        return { test, questions: (questionRows as Row[]).map(testQuestionRow) };
      },
      async listQuestions(testId) {
        const { data, error } = await client
          .from('test_questions')
          .select('*')
          .eq('test_id', testId)
          .order('position', { ascending: true });
        throwIfError(error);
        return (data as Row[]).map(testQuestionRow);
      },
      async delete(id) {
        const { error } = await client.from('tests').delete().eq('id', id);
        throwIfError(error);
      },
    },

    testAttempts: {
      async create(data) {
        const payload = {
          test_id: data.testId,
          pack_id: data.packId,
          user_id: data.userId,
          score: data.score,
          total: data.total,
          correct_count: data.correctCount,
          partial_count: data.partialCount,
          incorrect_count: data.incorrectCount,
          answers: data.answers,
          strong_concept_ids: data.strongConceptIds,
          weak_concept_ids: data.weakConceptIds,
        };
        const { data: row, error } = await client
          .from('test_attempts')
          .insert(payload)
          .select()
          .single();
        throwIfError(error);
        return testAttemptRow(row as Row);
      },
      async listByUserAndPack(userId, packId) {
        const { data, error } = await client
          .from('test_attempts')
          .select('*')
          .eq('user_id', userId)
          .eq('pack_id', packId)
          .order('created_at', { ascending: false })
          .limit(50);
        throwIfError(error);
        return (data as Row[]).map(testAttemptRow);
      },
      async listByUser(userId) {
        const { data, error } = await client
          .from('test_attempts')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50);
        throwIfError(error);
        return (data as Row[]).map(testAttemptRow);
      },
    },

    studyPlans: {
      async getByPack(packId) {
        const { data, error } = await client
          .from('study_plans')
          .select('*')
          .eq('pack_id', packId)
          .maybeSingle();
        throwIfError(error);
        return data ? studyPlanRow(data as Row) : null;
      },
      async upsert(data) {
        const payload = {
          pack_id: data.packId,
          owner_id: data.ownerId,
          exam_date: data.examDate,
          overview: data.overview,
          sessions: data.sessions,
          updated_at: new Date().toISOString(),
        };
        const { data: row, error } = await client
          .from('study_plans')
          .upsert(payload, { onConflict: 'pack_id' })
          .select()
          .single();
        throwIfError(error);
        return studyPlanRow(row as Row);
      },
      async deleteByPack(packId) {
        const { error } = await client.from('study_plans').delete().eq('pack_id', packId);
        throwIfError(error);
      },
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder is generic over unknown row shapes
type QueryBuilder = any;

function applySetFilters(query: QueryBuilder, filter: SetFilter): QueryBuilder {
  let q = query;
  if (filter.ownerId) q = q.eq('owner_id', filter.ownerId);
  if (filter.subjectId) q = q.eq('subject_id', filter.subjectId);
  if (filter.subject) q = q.ilike('subject_name', `%${filter.subject}%`);
  if (filter.level) q = q.eq('level', filter.level);
  if (filter.tag) q = q.contains('tags', [filter.tag]);
  if (filter.q) q = q.or(`title.ilike.%${filter.q}%,description.ilike.%${filter.q}%`);
  return q;
}

/** User-scoped Supabase database (RLS enforced by the caller's JWT). */
export function createSupabaseDatabase(accessToken: string | null): Database {
  return buildDatabase(userClient(accessToken), null);
}

/** Service-role database for trusted admin contexts only. */
export function createSupabaseAdminDatabase(): Database {
  const admin = serviceClient();
  return buildDatabase(userClient(null), admin);
}
