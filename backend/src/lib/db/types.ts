/** Database record types shared by all repository implementations (spec §12). */

export type Visibility = 'private' | 'public';
export type Role = 'user' | 'admin';
export type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer';
export type ReportStatus = 'open' | 'resolved' | 'dismissed';
export type ReportTargetType = 'study_set' | 'card' | 'profile';

export interface ProfileRecord {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUserRecord {
  id: string;
  email: string;
  createdAt: string;
}

export interface AdminUserRecord extends AuthUserRecord {
  displayName: string;
  role: Role;
}

export interface SubjectRecord {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudySetRecord {
  id: string;
  ownerId: string;
  subjectId: string | null;
  /** Denormalized subject name for display + discovery filters (kept in sync by services). */
  subjectName: string | null;
  title: string;
  slug: string;
  description: string;
  level: string;
  visibility: Visibility;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CardRecord {
  id: string;
  setId: string;
  question: string;
  answer: string;
  position: number;
  /**
   * Study Pack provenance (nullable): the source this card was generated from
   * and the concept it belongs to. Classic set/card flows leave both empty.
   */
  sourceId: string | null;
  conceptId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CardProgressRecord {
  id: string;
  userId: string;
  cardId: string;
  repetitionCount: number;
  ease: number | null;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
  correctCount: number;
  incorrectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuizRecord {
  id: string;
  setId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuizQuestionRecord {
  id: string;
  quizId: string;
  prompt: string;
  questionType: QuestionType;
  correctAnswer: string;
  options: string[] | null;
  position: number;
}

export interface QuizAttemptRecord {
  id: string;
  userId: string;
  quizId: string;
  setId: string | null;
  score: number;
  total: number;
  createdAt: string;
}

export interface StudySessionRecord {
  id: string;
  userId: string | null;
  setId: string | null;
  startedAt: string;
  endedAt: string | null;
  cardsSeen: number;
}

export interface FavoriteRecord {
  userId: string;
  setId: string;
  createdAt: string;
}

export interface ReportRecord {
  id: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface SetFilter {
  q?: string;
  subject?: string;
  subjectId?: string;
  level?: string;
  tag?: string;
  ownerId?: string;
  limit: number;
  offset: number;
}

export interface NewCard {
  question: string;
  answer: string;
  position: number;
  sourceId?: string | null;
  conceptId?: string | null;
}

export interface NewQuizQuestion {
  prompt: string;
  questionType: QuestionType;
  correctAnswer: string;
  options: string[] | null;
  position: number;
}

export interface ProgressUpsert {
  userId: string;
  cardId: string;
  repetitionCount: number;
  ease: number | null;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
  correctCount: number;
  incorrectCount: number;
}

export interface ReportCreate {
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  details: string | null;
}

export interface ReportPatch {
  status?: ReportStatus;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
}

export interface StudySessionCreate {
  userId: string | null;
  setId: string | null;
  startedAt: string;
}

export interface StudySessionPatch {
  endedAt?: string;
  cardsSeen?: number;
}

/* ------------------------------- Study Packs ------------------------------- */
/*
 * A Study Pack is the study-first object that wraps the classic study_sets →
 * cards model and gradually grows into the full learning workflow
 * (sources → concepts → content → practice → tests → mastery).
 *
 * Compatibility rule: every Study Pack keeps an optional `legacySetId` that
 * points at a normal study_sets row. Flashcards, study queue, spaced repetition
 * and quizzes therefore keep working unchanged for existing users.
 */

/** Kinds of material a pack can be built from. Only the first three are live. */
export type PackSourceKind =
  | 'text'
  | 'pdf'
  | 'set'
  | 'powerpoint'
  | 'youtube'
  | 'image'
  | 'audio';

/**
 * Asynchronous processing states. Uploading/processing are real states the UI
 * renders today; synchronous sources move straight to `ready`.
 */
export type PackSourceStatus = 'uploading' | 'processing' | 'ready' | 'failed';

/** Who produced a piece of learning content (provenance, not styling). */
export type ContentOrigin = 'user' | 'ai' | 'imported';

/** Practice/test verdicts, reused by concept mastery. */
export type AnswerVerdict = 'correct' | 'partial' | 'incorrect';

export interface StudyPackRecord {
  id: string;
  ownerId: string;
  subjectId: string | null;
  /** Denormalized subject name (kept in sync with subjects.name). */
  subjectName: string | null;
  title: string;
  description: string;
  level: string;
  visibility: Visibility;
  /** Optional exam date as an ISO calendar day (YYYY-MM-DD). */
  examDate: string | null;
  /** AI/user overview text for the pack. */
  summary: string | null;
  /** Source the summary was generated from (provenance). */
  summarySourceId: string | null;
  summaryUpdatedAt: string | null;
  /** Classic study_sets row that holds this pack's flashcards. */
  legacySetId: string | null;
  /**
   * True when the pack created that set (deleting the pack may delete it too).
   * False for packs backfilled from a pre-existing user set — those sets are
   * never deleted with the pack, so no student data can be lost.
   */
  ownsLegacySet: boolean;
  /* Reserved for future licensed school-book integrations (never scraped). */
  publisher: string | null;
  method: string | null;
  methodEdition: string | null;
  methodChapter: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyPackSourceRecord {
  id: string;
  packId: string;
  ownerId: string;
  kind: PackSourceKind;
  title: string;
  status: PackSourceStatus;
  /** Extracted text used to ground AI work; null until processing is done. */
  content: string | null;
  characterCount: number;
  pageCount: number | null;
  failureReason: string | null;
  /** Set when the source is an existing Lerno study set. */
  legacySetId: string | null;
  origin: ContentOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface ConceptRecord {
  id: string;
  packId: string;
  sourceId: string | null;
  name: string;
  explanation: string;
  origin: ContentOrigin;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** Per-user mastery of one concept — the basis for adaptive learning. */
export interface ConceptMasteryRecord {
  id: string;
  userId: string;
  conceptId: string;
  /** 0..1 (0 = unknown, 1 = mastered). */
  mastery: number;
  attempts: number;
  correctCount: number;
  incorrectCount: number;
  lastPracticedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PracticeQuestionRecord {
  id: string;
  packId: string;
  conceptId: string | null;
  sourceId: string | null;
  prompt: string;
  questionType: QuestionType;
  correctAnswer: string;
  options: string[] | null;
  explanation: string;
  origin: ContentOrigin;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface PracticeAttemptRecord {
  id: string;
  userId: string;
  packId: string;
  questionId: string;
  conceptId: string | null;
  answer: string;
  verdict: AnswerVerdict;
  createdAt: string;
}

/** Test size/mode: quick checks or an exam simulation. */
export type TestMode = 'quick10' | 'quick20' | 'exam';

export interface TestRecord {
  id: string;
  packId: string;
  ownerId: string;
  title: string;
  mode: TestMode;
  questionCount: number;
  createdAt: string;
}

export interface TestQuestionRecord {
  id: string;
  testId: string;
  questionId: string;
  position: number;
}

/** One graded answer inside a stored test attempt. */
export interface TestAnswerRecord {
  questionId: string;
  prompt: string;
  questionType: QuestionType;
  yourAnswer: string;
  correctAnswer: string;
  verdict: AnswerVerdict;
  explanation: string;
  conceptId: string | null;
  conceptName: string | null;
}

export interface TestAttemptRecord {
  id: string;
  testId: string;
  packId: string;
  userId: string;
  /** Points scored: correct = 1, partial = 0.5. */
  score: number;
  total: number;
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
  answers: TestAnswerRecord[];
  strongConceptIds: string[];
  weakConceptIds: string[];
  createdAt: string;
}

export interface StudyPlanSession {
  day: number;
  /** Calendar day (YYYY-MM-DD) when the plan starts from an exam date. */
  date: string | null;
  focus: string;
  activities: string[];
  minutes: number;
}

export interface StudyPlanRecord {
  id: string;
  packId: string;
  ownerId: string;
  examDate: string | null;
  overview: string;
  sessions: StudyPlanSession[];
  createdAt: string;
  updatedAt: string;
}

export interface NewConcept {
  name: string;
  explanation: string;
  sourceId: string | null;
  origin: ContentOrigin;
  position: number;
}

export interface NewPracticeQuestion {
  conceptId: string | null;
  sourceId: string | null;
  prompt: string;
  questionType: QuestionType;
  correctAnswer: string;
  options: string[] | null;
  explanation: string;
  origin: ContentOrigin;
  position: number;
}

export interface ConceptMasteryUpsert {
  userId: string;
  conceptId: string;
  mastery: number;
  attempts: number;
  correctCount: number;
  incorrectCount: number;
  lastPracticedAt: string | null;
}
