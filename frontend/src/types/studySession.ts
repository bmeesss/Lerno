/**
 * Study sessions, the daily plan and progress — the shapes the server returns.
 * The server owns all of this state; the UI only renders it.
 */
import type { QuestionType } from './index';

export type SessionType = 'learn' | 'practice' | 'review' | 'test';
export type SessionStatus = 'not_started' | 'active' | 'completed' | 'abandoned';
export type TestMode = 'quick10' | 'quick20' | 'exam';
export type SelfRating = 'again' | 'hard' | 'good' | 'easy';
export type AnswerVerdict = 'correct' | 'partial' | 'incorrect';
export type LearnReason = 'weak' | 'new' | 'learning' | 'due' | 'confirmation';

export interface SessionQuestion {
  id: string;
  prompt: string;
  questionType: QuestionType;
  options: string[] | null;
  conceptId: string | null;
  conceptName: string | null;
  sourceTitle: string | null;
}

export interface SessionSourceRef {
  title: string | null;
  ref: string | null;
  origin?: string | null;
}

export interface ItemFeedback {
  verdict: AnswerVerdict;
  correctAnswer: string;
  explanation: string;
  masteryBeforePercent: number | null;
  masteryAfterPercent: number | null;
  source: SessionSourceRef | null;
}

export interface ConceptExample {
  text: string;
  kind: 'source' | 'flashcard';
  sourceId: string | null;
  sourceTitle: string | null;
}

export interface LearnView {
  explanation: string;
  example: ConceptExample | null;
  sourceTitle: string | null;
  refLabel: string | null;
  origin: 'user' | 'ai' | 'imported';
  masteryPercent: number;
  reason: LearnReason;
}

export interface SessionItem {
  id: string;
  position: number;
  kind: 'concept' | 'question';
  status: 'pending' | 'answered' | 'skipped';
  conceptId: string | null;
  conceptName: string | null;
  question: SessionQuestion | null;
  learn: LearnView | null;
  answer: string | null;
  rating: SelfRating | null;
  /** Null while a test runs: no feedback, no mastery hints. */
  feedback: ItemFeedback | null;
}

export interface SessionProgress {
  position: number;
  total: number;
  answered: number;
  skipped: number;
  percent: number;
}

export interface SessionConceptChange {
  conceptId: string;
  name: string;
  beforePercent: number;
  afterPercent: number;
  answered: number;
  correct: number;
  incorrect: number;
}

export interface SessionConceptOutcome {
  conceptId: string;
  name: string;
  correct: number;
  partial: number;
  incorrect: number;
  total: number;
  percent: number;
  masteryPercent: number;
}

export interface SessionNextStep {
  type: SessionType;
  label: string;
  description: string;
  conceptId: string | null;
  conceptName: string | null;
}

export interface SessionResult {
  total: number;
  answered: number;
  skipped: number;
  correct: number;
  partial: number;
  incorrect: number;
  score: number;
  percent: number;
  durationSeconds: number;
  concepts: SessionConceptChange[];
  stillWeak: { conceptId: string; name: string; masteryPercent: number }[];
  packWeakCount: number;
  packMasteryPercent: number;
  knownWell: SessionConceptOutcome[];
  needsPractice: SessionConceptOutcome[];
  mistakeCount: number;
  next: SessionNextStep;
  testAttemptId: string | null;
}

export interface LearningSession {
  id: string;
  packId: string;
  packTitle: string;
  /** Only the owner of a pack can use its AI Tutor and take its tests. */
  isOwner: boolean;
  type: SessionType;
  mode: TestMode | null;
  status: SessionStatus;
  title: string;
  label: string;
  focusConceptId: string | null;
  focusConceptName: string | null;
  itemCount: number;
  answeredCount: number;
  currentPosition: number;
  progress: SessionProgress;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string;
  durationSeconds: number;
  hideFeedback: boolean;
  result: SessionResult | null;
  items: SessionItem[];
}

export interface SessionCreated {
  session: LearningSession;
  resumed: boolean;
}

export interface SessionItemResponse {
  item: SessionItem;
  progress: SessionProgress;
  session: {
    id: string;
    status: SessionStatus;
    currentPosition: number;
    answeredCount: number;
    durationSeconds: number;
  };
}

export interface SessionSaveResponse {
  saved: number;
  progress: SessionProgress;
  session: SessionItemResponse['session'];
}

export interface ResumeCard {
  sessionId: string;
  packId: string;
  packTitle: string;
  type: SessionType;
  mode: TestMode | null;
  status: SessionStatus;
  /** "Biology Practice" */
  label: string;
  /** "Question 6 of 10" */
  positionLabel: string;
  position: number;
  total: number;
  answeredCount: number;
  lastActivityAt: string;
}

export interface SessionPreview {
  packId: string;
  packTitle: string;
  type: SessionType;
  mode: TestMode | null;
  /** "Practice Biology" */
  title: string;
  count: number;
  minutes: number;
  difficulty: 'easy' | 'medium' | 'hard';
  focus: { label: string; conceptId: string | null; conceptName: string | null };
  concepts: { id: string; name: string; masteryPercent: number; reason: string }[];
  availableQuestions: number;
  availableConcepts: number;
  examDaysLeft: number | null;
  canStart: boolean;
  blockedReason: string | null;
  resume: ResumeCard | null;
  modes:
    | {
        mode: TestMode;
        label: string;
        description: string;
        count: number;
        minutes: number;
        available: boolean;
      }[]
    | null;
}

export interface SessionMistake {
  itemId: string;
  position: number;
  verdict: AnswerVerdict;
  question: {
    id: string;
    prompt: string;
    questionType: QuestionType;
    options: string[] | null;
  };
  yourAnswer: string;
  correctAnswer: string;
  explanation: string;
  concept: { id: string; name: string } | null;
  source: SessionSourceRef | null;
}

export interface SessionMistakes {
  sessionId: string;
  packId: string;
  packTitle: string;
  type: SessionType;
  total: number;
  mistakes: SessionMistake[];
}

/* ----------------------------- today / planner ----------------------------- */

export interface TodayStep {
  type:
    | 'review'
    | 'learn'
    | 'practice'
    | 'test'
    | 'continue'
    | 'generate-concepts'
    | 'generate-practice'
    | 'add-material';
  label: string;
  description: string;
  reasonText?: string;
  reason?: string;
  packId: string | null;
  packTitle?: string | null;
  subjectId?: string | null;
  subjectName?: string | null;
  conceptId: string | null;
  conceptName: string | null;
  sessionType?: SessionType | null;
  sessionId?: string | null;
  mode?: TestMode | null;
  count?: number | null;
  minutes?: number;
  examDaysLeft?: number | null;
  order?: number;
}

export interface TodayPlan {
  budgetMinutes: number;
  minutes: number;
  steps: (TodayStep & { order: number })[];
  adjustedForExam: boolean;
}

export interface ExamBanner {
  packId: string;
  title: string;
  examDate: string;
  daysLeft: number;
  message: string;
  note: string | null;
}

export interface SubjectToday {
  subjectId: string | null;
  subjectName: string;
  packs: number;
  masteryPercent: number | null;
  dueCards: number;
  weakConcepts: number;
  examDaysLeft: number | null;
  minutes: number;
  steps: (TodayStep & { order: number })[];
  next: TodayStep | null;
}

export interface StudyStreak {
  current: number;
  longest: number;
  lastActiveDay: string | null;
  todayDone: boolean;
}

/* -------------------------------- progress -------------------------------- */

export interface MasteryTrend {
  hasEnoughData: boolean;
  daysRecorded: number;
  minDays: number;
  points: { day: string; masteryPercent: number }[];
  changePercent: number | null;
  direction: 'up' | 'down' | 'steady' | null;
}

export interface ConceptLine {
  id: string;
  name: string;
  masteryPercent: number;
}

export interface PackProgressRow {
  packId: string;
  title: string;
  subjectId: string | null;
  subjectName: string | null;
  masteryPercent: number;
  conceptsTotal: number;
  trend: MasteryTrend;
  weakConcepts: ConceptLine[];
  strongConcepts: ConceptLine[];
  dueCards: number;
  lastActivityAt: string | null;
  sessionsCompleted: number;
  questionsAnswered: number;
  activeDaysLast7: number;
  examDate: string | null;
  examDaysLeft: number | null;
}

export interface StudyProgressOverview {
  today: string;
  timeZone: string;
  hasActivity: boolean;
  overall: {
    masteryPercent: number | null;
    conceptsTotal: number;
    conceptsMastered: number;
    conceptsWeak: number;
    studySeconds: number;
    studyMinutes: number;
    questionsAnswered: number;
    cardsReviewed: number;
    testsCompleted: number;
    sessionsCompleted: number;
    recentImprovement: { changePercent: number; windowDays: number; packs: number } | null;
    improvedConcepts: {
      conceptId: string;
      name: string;
      beforePercent: number;
      afterPercent: number;
      changePercent: number;
    }[];
  };
  trendMinDays: number;
  streak: StudyStreak;
  packs: PackProgressRow[];
}

export interface SubjectOverview {
  subject: { id: string; name: string };
  totals: {
    packs: number;
    concepts: number;
    masteryPercent: number | null;
    dueCards: number;
    weakConcepts: number;
  };
  packs: {
    packId: string;
    title: string;
    masteryPercent: number;
    concepts: number;
    dueCards: number;
    weakConcepts: ConceptLine[];
    lastStudiedAt: string | null;
    examDate: string | null;
    examDaysLeft: number | null;
    next: TodayStep | null;
    resume: ResumeCard | null;
  }[];
  exams: { packId: string; title: string; examDate: string | null; daysLeft: number | null }[];
  recentActivity: {
    sessionId: string;
    packId: string;
    label: string;
    type: SessionType;
    completedAt: string | null;
    percent: number | null;
    answered: number;
  }[];
  next: TodayStep | null;
}

/* ------------------------------ tutor + source ----------------------------- */

export interface TutorCitation {
  sourceId: string;
  title: string;
  ref: string | null;
}

export interface TutorContext {
  conceptId?: string;
  sessionId?: string;
  itemId?: string;
}

export interface ConceptSourceView {
  concept: { id: string; name: string };
  source: { id: string; title: string; kind: string } | null;
  excerpt: { text: string; ref: string | null; match: 'reference' | 'mention' | 'start' } | null;
}
