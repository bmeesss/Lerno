/** Database record types shared by all repository implementations (spec §12). */
import type {
  MaterialDifficulty,
  PackAnalysis,
  PackSourceKind,
  PackSourceStatus,
  SourceMetadata,
  SourceProcessingStage,
} from '../source-model.js';

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

/**
 * Kinds of material a pack can be built from, and their lifecycle. Both live in
 * the shared source model (`lib/source-model.ts`) so the pipeline, the database
 * and the API describe sources in exactly the same words.
 */
export type { PackSourceKind, PackSourceStatus, SourceProcessingStage };

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
  /** Source-grounded analysis every generation reuses (null until analyzed). */
  analysis: PackAnalysis | null;
  analysisUpdatedAt: string | null;
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
  /** Extraction provenance: language, references (page/slide/timestamp), method. */
  metadata: SourceMetadata;
  /** Stage the pipeline is (or stopped) at; null when no run happened yet. */
  processingStage: SourceProcessingStage | null;
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
  /** Provenance inside the source ("page 6", "slide 8", "03:42 in recording"). */
  refLabel: string | null;
  /** Relative importance of this concept for the material (0..1, null = unknown). */
  importance: number | null;
  /** Per-concept difficulty as judged from the material. */
  difficulty: MaterialDifficulty | null;
  /** Concept name this concept conflicts with, when sources disagree. */
  conflictWith: string | null;
  createdAt: string;
  updatedAt: string;
}

export type { MaterialDifficulty };

/** Per-user mastery of one concept — the basis for adaptive learning. */
export interface ConceptMasteryRecord {
  id: string;
  userId: string;
  conceptId: string;
  /** 0..1 (0 = unknown, 1 = mastered). */
  mastery: number;
  /** Outcome reliability, updated from real correct/incorrect interactions. */
  confidence: number;
  attempts: number;
  correctCount: number;
  incorrectCount: number;
  lastPracticedAt: string | null;
  nextReviewAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LearningEventType = 'learn' | 'flashcard' | 'practice' | 'test' | 'review' | 'self_rating';

/** Append-only, shared record of student interactions across study modes. */
export interface LearningEventRecord {
  id: string;
  userId: string;
  packId: string | null;
  conceptId: string | null;
  cardId: string | null;
  questionId: string | null;
  eventType: LearningEventType;
  isCorrect: boolean | null;
  responseTimeMs: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface LearningEventCreate {
  userId: string;
  packId?: string | null;
  conceptId?: string | null;
  cardId?: string | null;
  questionId?: string | null;
  eventType: LearningEventType;
  isCorrect?: boolean | null;
  responseTimeMs?: number | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
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

/** One concrete, launchable activity inside a plan day (added in 0011, optional). */
export interface StudyPlanTask {
  type: 'learn' | 'practice' | 'review' | 'test' | 'cards';
  label: string;
  minutes: number;
  conceptId?: string | null;
  conceptName?: string | null;
  mode?: TestMode | null;
  /** Number of concepts / questions / cards the task covers. */
  count?: number;
}

export interface StudyPlanSession {
  day: number;
  /** Calendar day (YYYY-MM-DD) when the plan starts from an exam date. */
  date: string | null;
  focus: string;
  /** Human readable lines. Always present so plans written before 0011 keep working. */
  activities: string[];
  minutes: number;
  /** Structured version of `activities`; absent on plans written before 0011. */
  tasks?: StudyPlanTask[];
  /** Daily study budget the plan was built for; kept so a refresh does not reset it. */
  budgetMinutes?: number;
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
  refLabel?: string | null;
  importance?: number | null;
  difficulty?: MaterialDifficulty | null;
  conflictWith?: string | null;
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
  confidence?: number;
  attempts: number;
  correctCount: number;
  incorrectCount: number;
  lastPracticedAt: string | null;
  nextReviewAt?: string | null;
}

/* ------------------------------ study sessions ------------------------------ */

export type LearningSessionType = 'learn' | 'practice' | 'review' | 'test';
export type LearningSessionStatus = 'not_started' | 'active' | 'completed' | 'abandoned';
export type LearningSessionItemStatus = 'pending' | 'answered' | 'skipped';
export type LearningSessionItemKind = 'concept' | 'question';
export type SelfRating = 'again' | 'hard' | 'good' | 'easy';

/** How one concept moved during a session (percentages, 0..100). */
export interface SessionConceptChange {
  conceptId: string;
  name: string;
  beforePercent: number;
  afterPercent: number;
  /** Answers on this concept inside the session (self-ratings count as one). */
  answered: number;
  correct: number;
  incorrect: number;
}

/** A concept in the Test analysis: how the student did on it in this test. */
export interface SessionConceptOutcome {
  conceptId: string;
  name: string;
  correct: number;
  partial: number;
  incorrect: number;
  total: number;
  /** Test score for this concept, 0..100. */
  percent: number;
  masteryPercent: number;
}

export interface SessionNextStep {
  type: 'learn' | 'practice' | 'review' | 'test';
  label: string;
  description: string;
  conceptId: string | null;
  conceptName: string | null;
}

/** Stored on the session when it completes; the server is the source of truth. */
export interface LearningSessionResult {
  total: number;
  answered: number;
  skipped: number;
  correct: number;
  partial: number;
  incorrect: number;
  /** Points: correct = 1, partial = 0.5. */
  score: number;
  /** 0..100 over all items of the session (unanswered items count as missed in a test). */
  percent: number;
  durationSeconds: number;
  concepts: SessionConceptChange[];
  /** Concepts touched by this session that are still weak afterwards. */
  stillWeak: { conceptId: string; name: string; masteryPercent: number }[];
  /** Weak concepts across the whole pack after the session. */
  packWeakCount: number;
  packMasteryPercent: number;
  /** Test only: concepts the student handled well / has to practise. */
  knownWell: SessionConceptOutcome[];
  needsPractice: SessionConceptOutcome[];
  mistakeCount: number;
  next: SessionNextStep;
  /** Test attempt written for a test session (reuses test_attempts). */
  testAttemptId: string | null;
}

export interface LearningSessionRecord {
  id: string;
  userId: string;
  packId: string;
  type: LearningSessionType;
  status: LearningSessionStatus;
  mode: TestMode | null;
  title: string;
  focusConceptId: string | null;
  targetConceptIds: string[];
  testId: string | null;
  itemCount: number;
  answeredCount: number;
  currentPosition: number;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string;
  durationSeconds: number;
  result: LearningSessionResult | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearningSessionCreate {
  userId: string;
  packId: string;
  type: LearningSessionType;
  status?: LearningSessionStatus;
  mode?: TestMode | null;
  title: string;
  focusConceptId?: string | null;
  targetConceptIds?: string[];
  testId?: string | null;
  itemCount: number;
  startedAt?: string | null;
}

export interface LearningSessionPatch {
  status?: LearningSessionStatus;
  answeredCount?: number;
  currentPosition?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  lastActivityAt?: string;
  durationSeconds?: number;
  result?: LearningSessionResult | null;
}

/** Slim row of every session a student ever had, for exact totals and streaks. */
export interface LearningSessionStat {
  packId: string;
  type: LearningSessionType;
  status: LearningSessionStatus;
  answeredCount: number;
  durationSeconds: number;
  completedAt: string | null;
  lastActivityAt: string;
}

export interface LearningSessionItemRecord {
  id: string;
  sessionId: string;
  userId: string;
  packId: string;
  position: number;
  kind: LearningSessionItemKind;
  conceptId: string | null;
  /** Question items: the question. Concept items: the "check yourself" question. */
  questionId: string | null;
  status: LearningSessionItemStatus;
  answer: string | null;
  verdict: AnswerVerdict | null;
  rating: SelfRating | null;
  /** 0..1, like concept_mastery.mastery. */
  masteryBefore: number | null;
  masteryAfter: number | null;
  responseTimeMs: number | null;
  answeredAt: string | null;
  createdAt: string;
}

export interface LearningSessionItemCreate {
  sessionId: string;
  userId: string;
  packId: string;
  position: number;
  kind: LearningSessionItemKind;
  conceptId?: string | null;
  questionId?: string | null;
}

export interface MasterySnapshotRecord {
  id: string;
  userId: string;
  packId: string;
  /** The student's local calendar day (YYYY-MM-DD). */
  day: string;
  masteryPercent: number;
  conceptsTotal: number;
  weakConcepts: number;
  masteredConcepts: number;
  createdAt: string;
  updatedAt: string;
}

export interface MasterySnapshotUpsert {
  userId: string;
  packId: string;
  day: string;
  masteryPercent: number;
  conceptsTotal: number;
  weakConcepts: number;
  masteredConcepts: number;
}
