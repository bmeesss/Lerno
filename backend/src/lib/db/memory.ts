/**
 * In-memory repository implementation.
 *
 * Used for local development ("development data mode") and automated tests so
 * the whole product runs without external infrastructure. Never used in
 * production (see config.ts).
 */
import { randomUUID } from 'node:crypto';
import type { Database } from './repository.js';
import type {
  AdminUserRecord,
  AuthUserRecord,
  CardProgressRecord,
  CardRecord,
  FavoriteRecord,
  NewCard,
  NewQuizQuestion,
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
  StudySessionCreate,
  StudySessionPatch,
  StudySessionRecord,
  StudySetRecord,
  SubjectRecord,
} from './types.js';

export interface MemoryState {
  users: AuthUserRecord[];
  profiles: Map<string, ProfileRecord>;
  subjects: Map<string, SubjectRecord>;
  sets: Map<string, StudySetRecord>;
  cards: Map<string, CardRecord>;
  progress: Map<string, CardProgressRecord>;
  quizzes: Map<string, QuizRecord>;
  quizQuestions: Map<string, QuizQuestionRecord[]>;
  attempts: QuizAttemptRecord[];
  sessions: Map<string, StudySessionRecord>;
  favorites: FavoriteRecord[];
  reports: Map<string, ReportRecord>;
}

export function createMemoryState(): MemoryState {
  return {
    users: [],
    profiles: new Map(),
    subjects: new Map(),
    sets: new Map(),
    cards: new Map(),
    progress: new Map(),
    quizzes: new Map(),
    quizQuestions: new Map(),
    attempts: [],
    sessions: new Map(),
    favorites: [],
    reports: new Map(),
  };
}

const now = (): string => new Date().toISOString();
const progressKey = (userId: string, cardId: string): string => `${userId}:${cardId}`;

export function createMemoryDatabase(state: MemoryState = createMemoryState()): Database {
  function progressFromUpsert(
    record: ProgressUpsert,
    existing?: CardProgressRecord,
  ): CardProgressRecord {
    const timestamp = now();
    return {
      id: existing?.id ?? randomUUID(),
      userId: record.userId,
      cardId: record.cardId,
      repetitionCount: record.repetitionCount,
      ease: record.ease,
      lastReviewedAt: record.lastReviewedAt,
      nextReviewAt: record.nextReviewAt,
      correctCount: record.correctCount,
      incorrectCount: record.incorrectCount,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
  }

  function matchesSetFilter(set: StudySetRecord, filter: SetFilter): boolean {
    if (filter.ownerId && set.ownerId !== filter.ownerId) return false;
    if (filter.subjectId && set.subjectId !== filter.subjectId) return false;
    if (filter.level && set.level.toLowerCase() !== filter.level.toLowerCase()) return false;
    if (filter.tag && !set.tags.some((tag) => tag.toLowerCase() === filter.tag!.toLowerCase())) {
      return false;
    }
    if (filter.q) {
      const needle = filter.q.toLowerCase();
      const haystack = `${set.title} ${set.description} ${set.tags.join(' ')}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  }

  return {
    async ping() {
      return;
    },

    profiles: {
      async get(id) {
        return state.profiles.get(id) ?? null;
      },
      async upsert(profile) {
        const timestamp = now();
        const existing = state.profiles.get(profile.id);
        const record: ProfileRecord = {
          id: profile.id,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl ?? existing?.avatarUrl ?? null,
          role: profile.role ?? existing?.role ?? 'user',
          timezone: profile.timezone ?? existing?.timezone ?? 'UTC',
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        state.profiles.set(profile.id, record);
        return record;
      },
      async update(id, patch) {
        const existing = state.profiles.get(id);
        if (!existing) throw new Error(`profile ${id} not found`);
        const record: ProfileRecord = {
          ...existing,
          displayName: patch.displayName ?? existing.displayName,
          avatarUrl: patch.avatarUrl === undefined ? existing.avatarUrl : patch.avatarUrl,
          timezone: patch.timezone ?? existing.timezone,
          updatedAt: now(),
        };
        state.profiles.set(id, record);
        return record;
      },
      async count() {
        return state.profiles.size;
      },
    },

    authUsers: {
      async list(limit, offset) {
        return state.users
          .slice()
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .slice(offset, offset + limit)
          .map((user) => {
            const profile = state.profiles.get(user.id);
            return {
              id: user.id,
              email: user.email,
              displayName: profile?.displayName ?? '',
              role: profile?.role ?? 'user',
              createdAt: user.createdAt,
            } satisfies AdminUserRecord;
          });
      },
      async count() {
        return state.users.length;
      },
      async setRole(userId, role: Role) {
        const profile = state.profiles.get(userId);
        if (!profile) throw new Error(`profile ${userId} not found`);
        state.profiles.set(userId, { ...profile, role, updatedAt: now() });
      },
      async delete(userId) {
        state.users = state.users.filter((user) => user.id !== userId);
        state.profiles.delete(userId);
      },
    },

    subjects: {
      async listByOwner(ownerId) {
        return [...state.subjects.values()]
          .filter((subject) => subject.ownerId === ownerId)
          .sort((a, b) => a.name.localeCompare(b.name));
      },
      async get(id) {
        return state.subjects.get(id) ?? null;
      },
      async create(data) {
        const timestamp = now();
        const record: SubjectRecord = {
          id: randomUUID(),
          ownerId: data.ownerId,
          name: data.name,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        state.subjects.set(record.id, record);
        return record;
      },
      async update(id, patch) {
        const existing = state.subjects.get(id);
        if (!existing) throw new Error(`subject ${id} not found`);
        const record: SubjectRecord = { ...existing, name: patch.name, updatedAt: now() };
        state.subjects.set(id, record);
        return record;
      },
      async delete(id) {
        state.subjects.delete(id);
      },
      async setCounts(subjectIds) {
        const counts: Record<string, number> = {};
        for (const id of subjectIds) counts[id] = 0;
        for (const set of state.sets.values()) {
          if (set.subjectId && counts[set.subjectId] !== undefined) counts[set.subjectId] += 1;
        }
        return counts;
      },
      async setsReferencing(subjectId) {
        return [...state.sets.values()].filter((set) => set.subjectId === subjectId);
      },
    },

    sets: {
      async get(id) {
        return state.sets.get(id) ?? null;
      },
      async listByOwner(ownerId) {
        return [...state.sets.values()]
          .filter((set) => set.ownerId === ownerId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },
      async listByIds(ids) {
        const wanted = new Set(ids);
        return [...state.sets.values()].filter((set) => wanted.has(set.id));
      },
      async listPublic(filter) {
        return [...state.sets.values()]
          .filter((set) => set.visibility === 'public')
          .filter((set) => matchesSetFilter(set, filter))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(filter.offset, filter.offset + filter.limit);
      },
      async countPublic(filter) {
        return [...state.sets.values()]
          .filter((set) => set.visibility === 'public')
          .filter((set) => matchesSetFilter(set, filter)).length;
      },
      async listByOwnerAndSubject(ownerId, subjectId) {
        return [...state.sets.values()].filter(
          (set) => set.ownerId === ownerId && set.subjectId === subjectId,
        );
      },
      async listPublicByOwner(ownerId) {
        return [...state.sets.values()].filter(
          (set) => set.ownerId === ownerId && set.visibility === 'public',
        );
      },
      async countAll() {
        return state.sets.size;
      },
      async create(data) {
        const timestamp = now();
        const record: StudySetRecord = {
          id: randomUUID(),
          ownerId: data.ownerId,
          subjectId: data.subjectId,
          subjectName: data.subjectName,
          title: data.title,
          slug: data.slug,
          description: data.description,
          level: data.level,
          visibility: data.visibility as StudySetRecord['visibility'],
          tags: data.tags,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        state.sets.set(record.id, record);
        return record;
      },
      async update(id, patch) {
        const existing = state.sets.get(id);
        if (!existing) throw new Error(`set ${id} not found`);
        const record: StudySetRecord = {
          ...existing,
          subjectId: patch.subjectId === undefined ? existing.subjectId : patch.subjectId,
          subjectName: patch.subjectName === undefined ? existing.subjectName : patch.subjectName,
          title: patch.title ?? existing.title,
          slug: patch.slug ?? existing.slug,
          description: patch.description ?? existing.description,
          level: patch.level ?? existing.level,
          visibility: (patch.visibility as StudySetRecord['visibility']) ?? existing.visibility,
          tags: patch.tags ?? existing.tags,
          updatedAt: now(),
        };
        state.sets.set(id, record);
        return record;
      },
      async delete(id) {
        state.sets.delete(id);
        for (const [key, card] of [...state.cards.entries()]) {
          if (card.setId === id) state.cards.delete(key);
        }
        for (const [key, quiz] of [...state.quizzes.entries()]) {
          if (quiz.setId === id) {
            state.quizzes.delete(key);
            state.quizQuestions.delete(key);
          }
        }
      },
    },

    cards: {
      async get(id) {
        return state.cards.get(id) ?? null;
      },
      async listBySet(setId) {
        return [...state.cards.values()]
          .filter((card) => card.setId === setId)
          .sort((a, b) => a.position - b.position);
      },
      async countBySets(setIds) {
        const counts: Record<string, number> = {};
        for (const id of setIds) counts[id] = 0;
        for (const card of state.cards.values()) {
          if (counts[card.setId] !== undefined) counts[card.setId] += 1;
        }
        return counts;
      },
      async createMany(setId, cards: NewCard[]) {
        const timestamp = now();
        const created: CardRecord[] = cards.map((card) => ({
          id: randomUUID(),
          setId,
          question: card.question,
          answer: card.answer,
          position: card.position,
          createdAt: timestamp,
          updatedAt: timestamp,
        }));
        for (const card of created) state.cards.set(card.id, card);
        return created;
      },
      async update(id, patch) {
        const existing = state.cards.get(id);
        if (!existing) throw new Error(`card ${id} not found`);
        const record: CardRecord = {
          ...existing,
          question: patch.question ?? existing.question,
          answer: patch.answer ?? existing.answer,
          position: patch.position ?? existing.position,
          updatedAt: now(),
        };
        state.cards.set(id, record);
        return record;
      },
      async delete(id) {
        state.cards.delete(id);
      },
      async deleteBySet(setId) {
        for (const [key, card] of [...state.cards.entries()]) {
          if (card.setId === setId) state.cards.delete(key);
        }
      },
      async countAll() {
        return state.cards.size;
      },
    },

    progress: {
      async get(userId, cardId) {
        return state.progress.get(progressKey(userId, cardId)) ?? null;
      },
      async upsert(record) {
        const key = progressKey(record.userId, record.cardId);
        const existing = state.progress.get(key);
        const saved = progressFromUpsert(record, existing);
        state.progress.set(key, saved);
        return saved;
      },
      async listByUser(userId) {
        return [...state.progress.values()].filter((p) => p.userId === userId);
      },
      async listDue(userId, nowIso) {
        return [...state.progress.values()]
          .filter((p) => p.userId === userId && p.nextReviewAt !== null && p.nextReviewAt <= nowIso)
          .sort((a, b) => (a.nextReviewAt ?? '').localeCompare(b.nextReviewAt ?? ''));
      },
      async listByUserAndSet(userId, setId) {
        const cardIds = new Set(
          [...state.cards.values()].filter((card) => card.setId === setId).map((card) => card.id),
        );
        return [...state.progress.values()].filter(
          (p) => p.userId === userId && cardIds.has(p.cardId),
        );
      },
    },

    quizzes: {
      async get(quizId) {
        return state.quizzes.get(quizId) ?? null;
      },
      async getBySet(setId) {
        return [...state.quizzes.values()].find((quiz) => quiz.setId === setId) ?? null;
      },
      async createWithQuestions(setId, title, questions: NewQuizQuestion[]) {
        const timestamp = now();
        const quiz: QuizRecord = {
          id: randomUUID(),
          setId,
          title,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const records: QuizQuestionRecord[] = questions.map((question) => ({
          id: randomUUID(),
          quizId: quiz.id,
          prompt: question.prompt,
          questionType: question.questionType,
          correctAnswer: question.correctAnswer,
          options: question.options,
          position: question.position,
        }));
        state.quizzes.set(quiz.id, quiz);
        state.quizQuestions.set(quiz.id, records);
        return { quiz, questions: records };
      },
      async listQuestions(quizId) {
        return (state.quizQuestions.get(quizId) ?? [])
          .slice()
          .sort((a, b) => a.position - b.position);
      },
      async deleteBySet(setId) {
        for (const [key, quiz] of [...state.quizzes.entries()]) {
          if (quiz.setId === setId) {
            state.quizzes.delete(key);
            state.quizQuestions.delete(key);
          }
        }
      },
      async deleteQuestionsBySet(setId) {
        for (const [key, quiz] of [...state.quizzes.entries()]) {
          if (quiz.setId === setId) {
            state.quizQuestions.set(key, []);
          }
        }
      },
      async replaceQuestions(quizId, questions: NewQuizQuestion[]) {
        const records: QuizQuestionRecord[] = questions.map((question) => ({
          id: randomUUID(),
          quizId,
          prompt: question.prompt,
          questionType: question.questionType,
          correctAnswer: question.correctAnswer,
          options: question.options,
          position: question.position,
        }));
        state.quizQuestions.set(quizId, records);
        return records;
      },
    },

    attempts: {
      async create(data) {
        const record: QuizAttemptRecord = {
          id: randomUUID(),
          userId: data.userId,
          quizId: data.quizId,
          setId: data.setId,
          score: data.score,
          total: data.total,
          createdAt: now(),
        };
        state.attempts.push(record);
        return record;
      },
      async listByUser(userId) {
        return state.attempts
          .filter((attempt) => attempt.userId === userId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      },
      async countAll() {
        return state.attempts.length;
      },
    },

    sessions: {
      async create(data: StudySessionCreate) {
        const record: StudySessionRecord = {
          id: randomUUID(),
          userId: data.userId,
          setId: data.setId,
          startedAt: data.startedAt,
          endedAt: null,
          cardsSeen: 0,
        };
        state.sessions.set(record.id, record);
        return record;
      },
      async update(id, patch: StudySessionPatch) {
        const existing = state.sessions.get(id);
        if (!existing) throw new Error(`session ${id} not found`);
        const record: StudySessionRecord = {
          ...existing,
          endedAt: patch.endedAt ?? existing.endedAt,
          cardsSeen: patch.cardsSeen ?? existing.cardsSeen,
        };
        state.sessions.set(id, record);
        return record;
      },
      async listByUser(userId) {
        return [...state.sessions.values()]
          .filter((session) => session.userId === userId)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      },
    },

    favorites: {
      async add(userId, setId) {
        if (state.favorites.some((f) => f.userId === userId && f.setId === setId)) return;
        state.favorites.push({ userId, setId, createdAt: now() });
      },
      async remove(userId, setId) {
        state.favorites = state.favorites.filter(
          (f) => !(f.userId === userId && f.setId === setId),
        );
      },
      async has(userId, setId) {
        return state.favorites.some((f) => f.userId === userId && f.setId === setId);
      },
      async listByUser(userId) {
        return state.favorites
          .filter((f) => f.userId === userId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      },
    },

    reports: {
      async create(data: ReportCreate) {
        const timestamp = now();
        const record: ReportRecord = {
          id: randomUUID(),
          reporterId: data.reporterId,
          targetType: data.targetType,
          targetId: data.targetId,
          reason: data.reason,
          details: data.details,
          status: 'open',
          createdAt: timestamp,
          resolvedAt: null,
          resolvedBy: null,
        };
        state.reports.set(record.id, record);
        return record;
      },
      async get(id) {
        return state.reports.get(id) ?? null;
      },
      async list(filter) {
        return [...state.reports.values()]
          .filter((report) => !filter.status || report.status === filter.status)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(filter.offset, filter.offset + filter.limit);
      },
      async count(filter) {
        return [...state.reports.values()].filter(
          (report) => !filter.status || report.status === filter.status,
        ).length;
      },
      async update(id, patch: ReportPatch) {
        const existing = state.reports.get(id);
        if (!existing) throw new Error(`report ${id} not found`);
        const record: ReportRecord = {
          ...existing,
          status: patch.status ?? existing.status,
          resolvedAt: patch.resolvedAt === undefined ? existing.resolvedAt : patch.resolvedAt,
          resolvedBy: patch.resolvedBy === undefined ? existing.resolvedBy : patch.resolvedBy,
        };
        state.reports.set(id, record);
        return record;
      },
      async countOpen() {
        return [...state.reports.values()].filter((report) => report.status === 'open').length;
      },
    },
  };
}

/** Helper for tests and dev auth: register a user record in the memory store. */
export function memoryAddUser(
  state: MemoryState,
  user: AuthUserRecord,
  profile: ProfileRecord,
): void {
  state.users.push(user);
  state.profiles.set(user.id, profile);
}
