/**
 * Repository contract (spec §21: database queries live in services/repositories).
 *
 * Two implementations:
 *  - memory.ts   → development data mode + tests (no external infrastructure)
 *  - supabase.ts → production: PostgreSQL via Supabase with RLS enforced by
 *                  binding every query to the caller's JWT.
 */
import type {
  AdminUserRecord,
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

export interface Database {
  ping(): Promise<void>;

  profiles: {
    get(id: string): Promise<ProfileRecord | null>;
    upsert(profile: {
      id: string;
      displayName: string;
      avatarUrl?: string | null;
      role?: Role;
    }): Promise<ProfileRecord>;
    update(
      id: string,
      patch: { displayName?: string; avatarUrl?: string | null },
    ): Promise<ProfileRecord>;
    count(): Promise<number>;
  };

  authUsers: {
    list(limit: number, offset: number): Promise<AdminUserRecord[]>;
    count(): Promise<number>;
    setRole(userId: string, role: Role): Promise<void>;
    delete(userId: string): Promise<void>;
  };

  subjects: {
    listByOwner(ownerId: string): Promise<SubjectRecord[]>;
    get(id: string): Promise<SubjectRecord | null>;
    create(data: { ownerId: string; name: string }): Promise<SubjectRecord>;
    update(id: string, patch: { name: string }): Promise<SubjectRecord>;
    delete(id: string): Promise<void>;
    setCounts(subjectIds: string[]): Promise<Record<string, number>>;
    /** Sets referencing this subject (for subject rename sync). */
    setsReferencing(subjectId: string): Promise<StudySetRecord[]>;
  };

  sets: {
    get(id: string): Promise<StudySetRecord | null>;
    listByOwner(ownerId: string): Promise<StudySetRecord[]>;
    listByIds(ids: string[]): Promise<StudySetRecord[]>;
    listPublic(filter: SetFilter): Promise<StudySetRecord[]>;
    countPublic(filter: SetFilter): Promise<number>;
    listByOwnerAndSubject(ownerId: string, subjectId: string): Promise<StudySetRecord[]>;
    listPublicByOwner(ownerId: string): Promise<StudySetRecord[]>;
    create(data: {
      ownerId: string;
      subjectId: string | null;
      subjectName: string | null;
      title: string;
      slug: string;
      description: string;
      level: string;
      visibility: string;
      tags: string[];
    }): Promise<StudySetRecord>;
    update(
      id: string,
      patch: {
        subjectId?: string | null;
        subjectName?: string | null;
        title?: string;
        slug?: string;
        description?: string;
        level?: string;
        visibility?: string;
        tags?: string[];
      },
    ): Promise<StudySetRecord>;
    delete(id: string): Promise<void>;
  };

  cards: {
    get(id: string): Promise<CardRecord | null>;
    listBySet(setId: string): Promise<CardRecord[]>;
    countBySets(setIds: string[]): Promise<Record<string, number>>;
    createMany(setId: string, cards: NewCard[]): Promise<CardRecord[]>;
    update(
      id: string,
      patch: { question?: string; answer?: string; position?: number },
    ): Promise<CardRecord>;
    delete(id: string): Promise<void>;
    deleteBySet(setId: string): Promise<void>;
  };

  progress: {
    get(userId: string, cardId: string): Promise<CardProgressRecord | null>;
    upsert(record: ProgressUpsert): Promise<CardProgressRecord>;
    listByUser(userId: string): Promise<CardProgressRecord[]>;
    listDue(userId: string, nowIso: string): Promise<CardProgressRecord[]>;
    listByUserAndSet(userId: string, setId: string): Promise<CardProgressRecord[]>;
  };

  quizzes: {
    get(quizId: string): Promise<QuizRecord | null>;
    getBySet(setId: string): Promise<QuizRecord | null>;
    createWithQuestions(
      setId: string,
      title: string,
      questions: NewQuizQuestion[],
    ): Promise<{ quiz: QuizRecord; questions: QuizQuestionRecord[] }>;
    listQuestions(quizId: string): Promise<QuizQuestionRecord[]>;
    deleteBySet(setId: string): Promise<void>;
  };

  attempts: {
    create(data: {
      userId: string;
      quizId: string;
      setId: string | null;
      score: number;
      total: number;
    }): Promise<QuizAttemptRecord>;
    listByUser(userId: string): Promise<QuizAttemptRecord[]>;
  };

  sessions: {
    create(data: StudySessionCreate): Promise<StudySessionRecord>;
    update(id: string, patch: StudySessionPatch): Promise<StudySessionRecord>;
    listByUser(userId: string): Promise<StudySessionRecord[]>;
  };

  favorites: {
    add(userId: string, setId: string): Promise<void>;
    remove(userId: string, setId: string): Promise<void>;
    has(userId: string, setId: string): Promise<boolean>;
    listByUser(userId: string): Promise<FavoriteRecord[]>;
  };

  reports: {
    create(data: ReportCreate): Promise<ReportRecord>;
    get(id: string): Promise<ReportRecord | null>;
    list(filter: { status?: string; limit: number; offset: number }): Promise<ReportRecord[]>;
    count(filter: { status?: string }): Promise<number>;
    update(id: string, patch: ReportPatch): Promise<ReportRecord>;
    countOpen(): Promise<number>;
  };
}
