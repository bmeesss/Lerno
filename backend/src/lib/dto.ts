/** Record → API DTO mappers (camelCase JSON shapes shared with the frontend). */

import type {
  CardProgressRecord,
  CardRecord,
  ProfileRecord,
  QuizAttemptRecord,
  QuizQuestionRecord,
  ReportRecord,
  StudySessionRecord,
  StudySetRecord,
  SubjectRecord,
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
};
