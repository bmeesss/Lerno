/** Record → API DTO mappers (camelCase JSON shapes shared with the frontend). */

import type {
  CardProgressRecord,
  CardRecord,
  ConceptRecord,
  PracticeQuestionRecord,
  ProfileRecord,
  QuizAttemptRecord,
  QuizQuestionRecord,
  ReportRecord,
  StudyPackRecord,
  StudyPackSourceRecord,
  StudyPlanRecord,
  StudySessionRecord,
  StudySetRecord,
  SubjectRecord,
  TestAttemptRecord,
} from './db/types.js';

export const dto = {
  profile: (record: ProfileRecord) => ({
    id: record.id,
    displayName: record.displayName,
    avatarUrl: record.avatarUrl,
    role: record.role,
    createdAt: record.createdAt,
  }),

  /**
   * Own profile: the public-safe fields plus the timezone the user chose
   * for local calendar days. Timezone stays private to the owner.
   */
  ownProfile: (record: ProfileRecord) => ({
    id: record.id,
    displayName: record.displayName,
    avatarUrl: record.avatarUrl,
    role: record.role,
    timezone: record.timezone,
    createdAt: record.createdAt,
  }),

  subject: (record: SubjectRecord, setCount: number) => ({
    id: record.id,
    name: record.name,
    setCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }),

  setSummary: (record: StudySetRecord, extras: { cardCount: number; authorName: string }) => ({
    id: record.id,
    ownerId: record.ownerId,
    subjectId: record.subjectId,
    subjectName: record.subjectName,
    title: record.title,
    slug: record.slug,
    description: record.description,
    level: record.level,
    visibility: record.visibility,
    tags: record.tags,
    cardCount: extras.cardCount,
    authorName: extras.authorName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }),

  card: (record: CardRecord) => ({
    id: record.id,
    question: record.question,
    answer: record.answer,
    position: record.position,
    /**
     * Provenance: which source this card came from and which concept it belongs
     * to. Null for classic set/card flows, so nothing existing changes.
     */
    sourceId: record.sourceId,
    conceptId: record.conceptId,
  }),

  progress: (record: CardProgressRecord) => ({
    cardId: record.cardId,
    repetitionCount: record.repetitionCount,
    ease: record.ease,
    lastReviewedAt: record.lastReviewedAt,
    nextReviewAt: record.nextReviewAt,
    correctCount: record.correctCount,
    incorrectCount: record.incorrectCount,
  }),

  quizQuestion: (record: QuizQuestionRecord, includeAnswer = false) => ({
    id: record.id,
    prompt: record.prompt,
    questionType: record.questionType,
    options: record.options,
    position: record.position,
    ...(includeAnswer ? { correctAnswer: record.correctAnswer } : {}),
  }),

  attempt: (record: QuizAttemptRecord) => ({
    id: record.id,
    quizId: record.quizId,
    setId: record.setId,
    score: record.score,
    total: record.total,
    createdAt: record.createdAt,
  }),

  session: (record: StudySessionRecord) => ({
    id: record.id,
    setId: record.setId,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    cardsSeen: record.cardsSeen,
  }),

  report: (record: ReportRecord) => ({
    id: record.id,
    reporterId: record.reporterId,
    targetType: record.targetType,
    targetId: record.targetId,
    reason: record.reason,
    details: record.details,
    status: record.status,
    createdAt: record.createdAt,
    resolvedAt: record.resolvedAt,
    resolvedBy: record.resolvedBy,
  }),

  /* ------------------------------ study packs ----------------------------- */

  studyPackSummary: (
    record: StudyPackRecord,
    extras: {
      sources: number;
      flashcards: number;
      concepts: number;
      practiceQuestions: number;
      masteryPercent: number;
      weakConcepts: number;
      dueCards: number;
      examDaysLeft: number | null;
    },
  ) => ({
    id: record.id,
    ownerId: record.ownerId,
    subjectId: record.subjectId,
    subjectName: record.subjectName,
    title: record.title,
    description: record.description,
    level: record.level,
    visibility: record.visibility,
    examDate: record.examDate,
    examDaysLeft: extras.examDaysLeft,
    legacySetId: record.legacySetId,
    sources: extras.sources,
    flashcards: extras.flashcards,
    concepts: extras.concepts,
    practiceQuestions: extras.practiceQuestions,
    masteryPercent: extras.masteryPercent,
    weakConcepts: extras.weakConcepts,
    dueCards: extras.dueCards,
    summaryUpdatedAt: record.summaryUpdatedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }),

  packSource: (record: StudyPackSourceRecord) => ({
    id: record.id,
    packId: record.packId,
    kind: record.kind,
    title: record.title,
    status: record.status,
    characterCount: record.characterCount,
    pageCount: record.pageCount,
    failureReason: record.failureReason,
    legacySetId: record.legacySetId,
    origin: record.origin,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }),

  concept: (
    record: ConceptRecord,
    extras: {
      sourceTitle: string | null;
      masteryPercent: number;
      attempts: number;
      cardCount: number;
      questionCount: number;
    },
  ) => ({
    id: record.id,
    packId: record.packId,
    name: record.name,
    explanation: record.explanation,
    sourceId: record.sourceId,
    sourceTitle: extras.sourceTitle,
    origin: record.origin,
    position: record.position,
    masteryPercent: extras.masteryPercent,
    attempts: extras.attempts,
    cardCount: extras.cardCount,
    questionCount: extras.questionCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }),

  practiceQuestion: (record: PracticeQuestionRecord, includeAnswer = false) => ({
    id: record.id,
    packId: record.packId,
    conceptId: record.conceptId,
    sourceId: record.sourceId,
    prompt: record.prompt,
    questionType: record.questionType,
    options: record.options,
    explanation: record.explanation,
    position: record.position,
    ...(includeAnswer ? { correctAnswer: record.correctAnswer } : {}),
  }),

  testAttempt: (record: TestAttemptRecord, extra: { packTitle: string | null }) => ({
    id: record.id,
    testId: record.testId,
    packId: record.packId,
    packTitle: extra.packTitle,
    score: record.score,
    total: record.total,
    correctCount: record.correctCount,
    partialCount: record.partialCount,
    incorrectCount: record.incorrectCount,
    answers: record.answers,
    strongConceptIds: record.strongConceptIds,
    weakConceptIds: record.weakConceptIds,
    createdAt: record.createdAt,
  }),

  studyPlan: (record: StudyPlanRecord) => ({
    id: record.id,
    packId: record.packId,
    examDate: record.examDate,
    overview: record.overview,
    sessions: record.sessions,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }),
};

