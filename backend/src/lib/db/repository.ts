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
  ConceptMasteryRecord,
  ConceptMasteryUpsert,
  ConceptRecord,
  LearningEventCreate,
  LearningEventRecord,
  LearningEventType,
  LearningSessionCreate,
  LearningSessionItemCreate,
  LearningSessionItemRecord,
  LearningSessionPatch,
  LearningSessionRecord,
  LearningSessionStat,
  LearningSessionStatus,
  FavoriteRecord,
  MasterySnapshotRecord,
  MasterySnapshotUpsert,
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
  TestAnswerRecord,
  TestAttemptRecord,
  TestMode,
  TestQuestionRecord,
  TestRecord,
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
      timezone?: string;
    }): Promise<ProfileRecord>;
    update(
      id: string,
      patch: { displayName?: string; avatarUrl?: string | null; timezone?: string },
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
    countAll(): Promise<number>;
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
    listBySets(setIds: string[]): Promise<CardRecord[]>;
    countBySets(setIds: string[]): Promise<Record<string, number>>;
    createMany(setId: string, cards: NewCard[]): Promise<CardRecord[]>;
    update(
      id: string,
      patch: {
        question?: string;
        answer?: string;
        position?: number;
        /** Study Pack provenance (nullable; classic flows never set these). */
        sourceId?: string | null;
        conceptId?: string | null;
      },
    ): Promise<CardRecord>;
    delete(id: string): Promise<void>;
    deleteBySet(setId: string): Promise<void>;
    countAll(): Promise<number>;
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
    /**
     * Deletes only the questions of a set's quiz (the quiz row and its
     * attempts are kept). Used to invalidate cached quizzes when cards
     * change; questions regenerate on the next quiz load.
     */
    deleteQuestionsBySet(setId: string): Promise<void>;
    /**
     * Replaces all questions of an existing quiz (keeps the quiz row, so
     * attempts stay linked). Used when regenerating after invalidation.
     */
    replaceQuestions(quizId: string, questions: NewQuizQuestion[]): Promise<QuizQuestionRecord[]>;
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
    countAll(): Promise<number>;
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

  /* ----------------------------- study packs ----------------------------- */

  packs: {
    get(id: string): Promise<StudyPackRecord | null>;
    listByOwner(ownerId: string): Promise<StudyPackRecord[]>;
    listByOwnerAndSubject(ownerId: string, subjectId: string): Promise<StudyPackRecord[]>;
    listByIds(ids: string[]): Promise<StudyPackRecord[]>;
    /** Reverse lookup for the compatibility bridge from a study_sets row. */
    getByLegacySetId(setId: string): Promise<StudyPackRecord | null>;
    /** Packs with an exam date on or after `fromDay` (YYYY-MM-DD), soonest first. */
    listUpcomingExams(ownerId: string, fromDay: string): Promise<StudyPackRecord[]>;
    create(data: {
      ownerId: string;
      subjectId: string | null;
      subjectName: string | null;
      title: string;
      description: string;
      level: string;
      visibility: string;
      examDate: string | null;
      legacySetId: string | null;
      ownsLegacySet?: boolean;
      publisher?: string | null;
      method?: string | null;
      methodEdition?: string | null;
      methodChapter?: string | null;
    }): Promise<StudyPackRecord>;
    update(
      id: string,
      patch: {
        subjectId?: string | null;
        subjectName?: string | null;
        title?: string;
        description?: string;
        level?: string;
        visibility?: string;
        examDate?: string | null;
        summary?: string | null;
        summarySourceId?: string | null;
        summaryUpdatedAt?: string | null;
        analysis?: StudyPackRecord['analysis'];
        analysisUpdatedAt?: string | null;
        publisher?: string | null;
        method?: string | null;
        methodEdition?: string | null;
        methodChapter?: string | null;
      },
    ): Promise<StudyPackRecord>;
    delete(id: string): Promise<void>;
  };

  packSources: {
    get(id: string): Promise<StudyPackSourceRecord | null>;
    listByPack(packId: string): Promise<StudyPackSourceRecord[]>;
    listByPacks(packIds: string[]): Promise<StudyPackSourceRecord[]>;
    /**
     * Every source of one student, across their packs. Used to spot an
     * accidental re-import of the same material (content fingerprint).
     */
    listByOwner(ownerId: string): Promise<StudyPackSourceRecord[]>;
    countByPacks(packIds: string[]): Promise<Record<string, number>>;
    create(data: {
      packId: string;
      ownerId: string;
      kind: StudyPackSourceRecord['kind'];
      title: string;
      status: StudyPackSourceRecord['status'];
      content: string | null;
      characterCount: number;
      pageCount: number | null;
      failureReason: string | null;
      legacySetId: string | null;
      origin: StudyPackSourceRecord['origin'];
      metadata?: StudyPackSourceRecord['metadata'];
      processingStage?: StudyPackSourceRecord['processingStage'];
    }): Promise<StudyPackSourceRecord>;
    update(
      id: string,
      patch: {
        title?: string;
        status?: StudyPackSourceRecord['status'];
        content?: string | null;
        characterCount?: number;
        pageCount?: number | null;
        failureReason?: string | null;
        metadata?: StudyPackSourceRecord['metadata'];
        processingStage?: StudyPackSourceRecord['processingStage'];
      },
    ): Promise<StudyPackSourceRecord>;
    delete(id: string): Promise<void>;
  };

  concepts: {
    get(id: string): Promise<ConceptRecord | null>;
    listByPack(packId: string): Promise<ConceptRecord[]>;
    listByPacks(packIds: string[]): Promise<ConceptRecord[]>;
    listByIds(ids: string[]): Promise<ConceptRecord[]>;
    countByPacks(packIds: string[]): Promise<Record<string, number>>;
    createMany(packId: string, concepts: NewConcept[]): Promise<ConceptRecord[]>;
    update(
      id: string,
      patch: {
        name?: string;
        explanation?: string;
        position?: number;
        refLabel?: string | null;
        importance?: number | null;
        difficulty?: ConceptRecord['difficulty'];
        conflictWith?: string | null;
      },
    ): Promise<ConceptRecord>;
    delete(id: string): Promise<void>;
    /** Cards/questions pointing at this concept, used for safe deletes. */
    detachFromCards(conceptId: string): Promise<void>;
  };

  conceptMastery: {
    get(userId: string, conceptId: string): Promise<ConceptMasteryRecord | null>;
    listByUser(userId: string): Promise<ConceptMasteryRecord[]>;
    listByUserAndPack(userId: string, packId: string): Promise<ConceptMasteryRecord[]>;
    upsert(record: ConceptMasteryUpsert): Promise<ConceptMasteryRecord>;
    /** One round trip for a whole session (one row per concept). */
    upsertMany(records: ConceptMasteryUpsert[]): Promise<ConceptMasteryRecord[]>;
  };

  learningEvents: {
    create(event: LearningEventCreate): Promise<LearningEventRecord>;
    createMany(events: LearningEventCreate[]): Promise<LearningEventRecord[]>;
    listByUser(userId: string, since?: string): Promise<LearningEventRecord[]>;
    /** Exact number of events of the given types (no row cap). */
    countByUser(userId: string, eventTypes: LearningEventType[]): Promise<number>;
  };

  practiceQuestions: {
    get(id: string): Promise<PracticeQuestionRecord | null>;
    listByPack(packId: string): Promise<PracticeQuestionRecord[]>;
    listByPacks(packIds: string[]): Promise<PracticeQuestionRecord[]>;
    listByIds(ids: string[]): Promise<PracticeQuestionRecord[]>;
    countByPacks(packIds: string[]): Promise<Record<string, number>>;
    createMany(packId: string, questions: NewPracticeQuestion[]): Promise<PracticeQuestionRecord[]>;
    update(
      id: string,
      patch: {
        prompt?: string;
        questionType?: PracticeQuestionRecord['questionType'];
        correctAnswer?: string;
        options?: string[] | null;
        explanation?: string;
        conceptId?: string | null;
      },
    ): Promise<PracticeQuestionRecord>;
    delete(id: string): Promise<void>;
  };

  practiceAttempts: {
    create(data: {
      userId: string;
      packId: string;
      questionId: string;
      conceptId: string | null;
      answer: string;
      verdict: PracticeAttemptRecord['verdict'];
    }): Promise<PracticeAttemptRecord>;
    createMany(
      rows: {
        userId: string;
        packId: string;
        questionId: string;
        conceptId: string | null;
        answer: string;
        verdict: PracticeAttemptRecord['verdict'];
      }[],
    ): Promise<PracticeAttemptRecord[]>;
    listByUser(userId: string): Promise<PracticeAttemptRecord[]>;
    listByUserAndPack(userId: string, packId: string): Promise<PracticeAttemptRecord[]>;
    /** Exact number of graded practice answers (no row cap). */
    countByUser(userId: string): Promise<number>;
  };

  tests: {
    get(id: string): Promise<TestRecord | null>;
    listByPack(packId: string): Promise<TestRecord[]>;
    listByUser(userId: string): Promise<TestRecord[]>;
    createTest(data: {
      packId: string;
      ownerId: string;
      title: string;
      mode: TestMode;
      questionIds: string[];
    }): Promise<{ test: TestRecord; questions: TestQuestionRecord[] }>;
    listQuestions(testId: string): Promise<TestQuestionRecord[]>;
    delete(id: string): Promise<void>;
  };

  testAttempts: {
    create(data: {
      testId: string;
      packId: string;
      userId: string;
      score: number;
      total: number;
      correctCount: number;
      partialCount: number;
      incorrectCount: number;
      answers: TestAnswerRecord[];
      strongConceptIds: string[];
      weakConceptIds: string[];
    }): Promise<TestAttemptRecord>;
    listByUserAndPack(userId: string, packId: string): Promise<TestAttemptRecord[]>;
    listByUser(userId: string): Promise<TestAttemptRecord[]>;
    /** Exact number of finished tests and answered test questions (no row cap). */
    totalsByUser(userId: string): Promise<{ attempts: number; answers: number }>;
  };

  studyPlans: {
    getByPack(packId: string): Promise<StudyPlanRecord | null>;
    upsert(data: {
      packId: string;
      ownerId: string;
      examDate: string | null;
      overview: string;
      sessions: StudyPlanRecord['sessions'];
    }): Promise<StudyPlanRecord>;
    deleteByPack(packId: string): Promise<void>;
  };

  /* --------------------------- study sessions (0011) --------------------------- */

  learningSessions: {
    get(id: string): Promise<LearningSessionRecord | null>;
    create(data: LearningSessionCreate): Promise<LearningSessionRecord>;
    update(id: string, patch: LearningSessionPatch): Promise<LearningSessionRecord>;
    /** Newest activity first. Every filter is optional. */
    listByUser(
      userId: string,
      filter?: {
        statuses?: LearningSessionStatus[];
        packId?: string;
        /** Only sessions with activity at or after this instant. */
        since?: string;
        limit?: number;
      },
    ): Promise<LearningSessionRecord[]>;
    /** Every session of the student as slim rows (no row cap): totals, streak, activity. */
    statsByUser(userId: string): Promise<LearningSessionStat[]>;
  };

  learningSessionItems: {
    createMany(items: LearningSessionItemCreate[]): Promise<LearningSessionItemRecord[]>;
    /** Ordered by position. */
    listBySession(sessionId: string): Promise<LearningSessionItemRecord[]>;
    /** One query for a whole list of sessions (resume list, subject overview). */
    listBySessions(sessionIds: string[]): Promise<LearningSessionItemRecord[]>;
    /** Items the student has already been shown in this pack (answered or skipped). */
    listSeenByUserAndPack(userId: string, packId: string): Promise<LearningSessionItemRecord[]>;
    /** Replaces the mutable state of whole items in one round trip. */
    saveMany(items: LearningSessionItemRecord[]): Promise<LearningSessionItemRecord[]>;
  };

  masterySnapshots: {
    upsertMany(rows: MasterySnapshotUpsert[]): Promise<MasterySnapshotRecord[]>;
    /** Oldest day first. `sinceDay` is an inclusive YYYY-MM-DD lower bound. */
    listByUser(userId: string, sinceDay?: string): Promise<MasterySnapshotRecord[]>;
  };
}
