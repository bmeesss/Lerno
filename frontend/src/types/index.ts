/** Shared domain types mirroring the API (see docs/LERNO_SPEC.md §12). */

export type Visibility = 'private' | 'public';

export type Role = 'user' | 'admin';

export type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer';

export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
  timezone: string;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  profile: Profile;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string | null;
  user: AuthUser;
}

export interface SignupResult {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser;
  /** True when the backend requires email confirmation before the first session. */
  needsEmailConfirmation: boolean;
}

export interface Subject {
  id: string;
  name: string;
  setCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudySetSummary {
  id: string;
  ownerId: string;
  subjectId: string | null;
  subjectName: string | null;
  title: string;
  slug: string;
  description: string;
  level: string;
  visibility: Visibility;
  tags: string[];
  cardCount: number;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudySetDetail extends StudySetSummary {
  isOwner: boolean;
  favorited: boolean;
  cards: Card[];
}

export interface Card {
  id: string;
  question: string;
  answer: string;
  position: number;
  /** Study Pack provenance (absent on classic set responses). */
  sourceId?: string | null;
  conceptId?: string | null;
}

export interface CardProgress {
  cardId: string;
  repetitionCount: number;
  ease: number | null;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
  correctCount: number;
  incorrectCount: number;
}

export type ReviewResult = 'correct' | 'incorrect';

export interface StudyReviewInput {
  setId: string;
  cardId: string;
  result: ReviewResult;
}

export interface StudyReviewResponse {
  progress: CardProgress;
  /** Re-queued into the current session because it was answered incorrectly. */
  requeued: boolean;
}

export interface StudySession {
  id: string;
  setId: string | null;
  startedAt: string;
  endedAt: string | null;
  cardsSeen: number;
}

export interface DueGroup {
  setId: string;
  setTitle: string;
  subjectName: string | null;
  dueCount: number;
  nextReviewAt: string | null;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  questionType: QuestionType;
  options: string[] | null;
  position: number;
}

export interface Quiz {
  id: string;
  setId: string;
  title: string;
  questions: QuizQuestion[];
}

export interface QuizAnswerInput {
  questionId: string;
  answer: string;
}

export interface QuizQuestionResult {
  questionId: string;
  prompt: string;
  questionType: QuestionType;
  yourAnswer: string;
  correctAnswer: string;
  correct: boolean;
  options: string[] | null;
}

export interface QuizAttemptResult {
  quizId: string;
  score: number;
  total: number;
  accuracy: number;
  correct: number;
  incorrect: number;
  questions: QuizQuestionResult[];
  topicsNeedingPractice: string[];
  /** False for guest submissions (not saved to a profile). */
  persisted: boolean;
}

export interface DashboardData {
  greetingName: string;
  cardsDue: number;
  streakDays: number;
  cardsStudied: number;
  quizAccuracy: number | null;
  recentSets: StudySetSummary[];
  dueGroups: DueGroup[];
  subjectProgress: SubjectProgress[];
  continueSet: StudySetSummary | null;
  today: TodaySummary;
  suggestions: StudySetSummary[];
}

export interface StreakInfo {
  current: number;
  longest: number;
  lastActiveDay: string | null;
}

export type ContinueAction =
  | { type: 'review'; setId: string; setTitle: string; dueCount: number }
  | { type: 'continue-session'; sessionId: string; setId: string; setTitle: string }
  | { type: 'study-set'; setId: string; setTitle: string; remaining: number }
  | { type: 'daily-goal'; setId: string; setTitle: string; remaining: number }
  | { type: 'create-set' }
  | { type: 'discover' };

export interface UpcomingReviews {
  dueNow: number;
  laterToday: number;
  tomorrow: number;
  next7Days: number;
}

export interface ComebackInfo {
  awayDays: number;
  dueCount: number;
  message: string;
}

export interface TodaySummary {
  date: string;
  target: number;
  completedCards: number;
  completionPercentage: number;
  goalReached: boolean;
  cardsDue: number;
  upcoming: UpcomingReviews;
  streak: StreakInfo;
  comeback: ComebackInfo | null;
  continueAction: ContinueAction;
}

export interface WeekDaySummary {
  day: string;
  active: boolean;
  cardsTouched: number;
  quizzes: number;
  studyMinutes: number;
}

export interface WeekSummary {
  weekStart: string;
  studyDays: number;
  cardsStudied: number;
  quizzesCompleted: number;
  quizAccuracy: number | null;
  studyTimeMinutes: number;
  currentStreak: number;
  days: WeekDaySummary[];
}

export interface SubjectProgress {
  subjectId: string | null;
  subjectName: string;
  setId?: string;
  setTitle?: string;
  totalCards: number;
  learnedCards: number;
  dueCards: number;
  accuracy: number | null;
}

export interface ProgressStats {
  cardsStudied: number;
  correctAnswers: number;
  incorrectAnswers: number;
  dueCards: number;
  quizAttempts: number;
  accuracy: number | null;
  quizAccuracy: number | null;
  studyTimeMinutes: number;
  streakDays: number;
  longestStreak: number;
  lastActiveDay: string | null;
  subjectProgress: SubjectProgress[];
  setProgress: SubjectProgress[];
}

export interface DiscoverFilters {
  q?: string;
  subject?: string;
  level?: string;
  tag?: string;
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type ReportStatus = 'open' | 'resolved' | 'dismissed';

export type ReportTargetType = 'study_set' | 'card' | 'profile';

export interface Report {
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

export interface AdminMetrics {
  users: number;
  publicSets: number;
  totalSets: number;
  openReports: number;
  cards: number;
  quizAttempts: number;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
}

/* ---------------------------- Lerno AI learning ---------------------------- */

export type AiDifficulty = 'easy' | 'normal' | 'hard';
export type AiQuizType = 'multiple_choice' | 'open' | 'true_false';
export type AiCardAction = 'explain' | 'example' | 'hint' | 'practice';
export type AiVerdict = 'correct' | 'partial' | 'incorrect';

export interface AiContextMeta {
  setId: string;
  totalCards: number;
  contextCards: number;
  omittedCards: number;
}

export interface AiExplanation {
  explanation: string;
  meta: AiContextMeta;
}

/** The backend normalizes summarize to `{ explanation }` shape as well. */
export type AiSummary = AiExplanation;

export interface AiGeneratedQuestion {
  type: 'open' | 'multiple_choice';
  question: string;
  answer: string;
  hint: string;
  options: string[];
  correctIndex: number | null;
  /** Set when the question was based on one specific card (enables progress). */
  cardId?: string | null;
}

export interface AiGeneratedQuestions {
  questions: AiGeneratedQuestion[];
  meta?: AiContextMeta;
}

export interface AiGeneratedQuizQuestion {
  type: AiQuizType;
  question: string;
  options: string[];
  correctIndex: number | null;
  answer: string;
  explanation: string;
}

export interface AiGeneratedQuiz {
  questions: AiGeneratedQuizQuestion[];
  meta?: AiContextMeta;
}

export interface AiGeneratedSetCard {
  front: string;
  back: string;
}

export interface AiGeneratedSet {
  title: string;
  description: string;
  cards: AiGeneratedSetCard[];
}

export interface AiCardActionResult {
  text: string;
  action: AiCardAction;
}

export interface AiEvaluation {
  verdict: AiVerdict;
  feedback: string;
  missing: string;
}

export interface AiHint {
  hint: string;
}

export interface AiStudyResultInput {
  cardId?: string;
  question: string;
  answer: string;
  verdict: AiVerdict;
}

export interface AiStudyFinishInput {
  setId: string;
  results: AiStudyResultInput[];
}

export interface AiStudySummary {
  setId: string;
  total: number;
  correct: number;
  partial: number;
  incorrect: number;
  accuracy: number;
  topicsToReview: string[];
  persisted: boolean;
}

/* -------------------------------- Study Packs ------------------------------- */

export type PackSourceKind = 'text' | 'pdf' | 'set' | 'powerpoint' | 'youtube' | 'image' | 'audio';
export type PackSourceStatus = 'pending' | 'uploading' | 'processing' | 'ready' | 'failed';

/** How a source was turned into text (extraction provenance, never model output). */
export type SourceExtractionMethod =
  | 'user'
  | 'pdf-text'
  | 'pptx-xml'
  | 'ocr'
  | 'transcription'
  | 'youtube-captions'
  | 'set';

export interface PackSourceReference {
  marker: string;
  kind: 'page' | 'slide' | 'timestamp' | 'section' | 'card' | 'video' | 'none';
  /** Human label: "page 6", "slide 8", "03:42". */
  label: string;
}

export interface StudyPackSource {
  id: string;
  packId: string;
  kind: PackSourceKind;
  title: string;
  status: PackSourceStatus;
  characterCount: number;
  pageCount: number | null;
  failureReason: string | null;
  legacySetId: string | null;
  origin: 'user' | 'ai' | 'imported';
  /** Detected language of the material ("unknown" when Lerno could not tell). */
  language: 'nl' | 'en' | 'unknown';
  /** Internal pipeline stage the source is in (null when it is done). */
  stage: 'extract' | 'normalize' | 'analyze' | 'generate' | 'review' | null;
  extractedBy: SourceExtractionMethod | null;
  slideCount: number | null;
  durationSeconds: number | null;
  channel: string | null;
  url: string | null;
  /** Honest notes about what extraction could or could not do. */
  warnings: string[];
  /** Bounded reference labels so provenance stays real, not decorative. */
  references: PackSourceReference[];
  createdAt: string;
  updatedAt: string;
}

export interface AdaptiveLearnConcept {
  id: string;
  name: string;
  explanation: string;
  position: number;
  masteryPercent: number;
  confidencePercent: number;
  attempts: number;
  lastPracticedAt: string | null;
  cardCount: number;
  questionCount: number;
}

export interface AdaptiveLearnNext {
  concept: AdaptiveLearnConcept | null;
  remaining: number;
  reason: 'weak' | 'new' | 'due' | 'learning' | 'confirmation' | null;
}

export interface StudyPackConcept {
  id: string;
  packId: string;
  name: string;
  explanation: string;
  sourceId: string | null;
  sourceTitle: string | null;
  origin: 'user' | 'ai' | 'imported';
  position: number;
  /** Provenance inside the source: "page 6", "slide 8", "03:42 in recording". */
  refLabel: string | null;
  importance: number | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  /** Set when this concept disagrees with another source (conflict marker). */
  conflictWith: string[] | null;
  masteryPercent: number;
  attempts: number;
  cardCount: number;
  questionCount: number;
  createdAt: string;
  updatedAt: string;
}

export type RecommendedActionType =
  | 'add-source'
  | 'generate-concepts'
  | 'generate-flashcards'
  | 'generate-practice'
  | 'learn'
  | 'review'
  | 'practice'
  | 'test';

export interface RecommendedAction {
  type: RecommendedActionType;
  label: string;
  description: string;
  conceptId?: string | null;
  conceptName?: string | null;
}

export interface StudyPackSummary {
  id: string;
  ownerId: string;
  subjectId: string | null;
  subjectName: string | null;
  title: string;
  description: string;
  level: string;
  visibility: Visibility;
  examDate: string | null;
  examDaysLeft: number | null;
  legacySetId: string | null;
  sources: number;
  flashcards: number;
  concepts: number;
  practiceQuestions: number;
  masteryPercent: number;
  weakConcepts: number;
  learningConcepts: number;
  masteredConcepts: number;
  dueCards: number;
  lastStudiedAt: string | null;
  cardsReviewed: number;
  practiceAnswers: number;
  testsCompleted: number;
  summaryUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyPackTestSummary {
  id: string;
  title: string;
  mode: 'quick10' | 'quick20' | 'exam';
  questionCount: number;
  createdAt: string;
}

export interface PackTestAnswerRecord {
  questionId: string;
  prompt: string;
  questionType: QuestionType;
  yourAnswer: string;
  correctAnswer: string;
  verdict: 'correct' | 'partial' | 'incorrect';
  explanation: string;
  conceptId: string | null;
  conceptName: string | null;
}

export interface PackTestAttempt {
  id: string;
  testId: string;
  packId: string;
  packTitle: string | null;
  score: number;
  total: number;
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
  answers: PackTestAnswerRecord[];
  strongConceptIds: string[];
  weakConceptIds: string[];
  createdAt: string;
}

export interface StudyPlanSession {
  day: number;
  date: string | null;
  focus: string;
  activities: string[];
  minutes: number;
}

export interface StudyPlan {
  id: string;
  packId: string;
  examDate: string | null;
  overview: string;
  sessions: StudyPlanSession[];
  createdAt: string;
  updatedAt: string;
}

export interface StudyPackDetail {
  id: string;
  ownerId: string;
  isOwner: boolean;
  title: string;
  description: string;
  subjectId: string | null;
  subjectName: string | null;
  level: string;
  visibility: Visibility;
  examDate: string | null;
  examDaysLeft: number | null;
  summary: string | null;
  summarySourceId: string | null;
  summaryUpdatedAt: string | null;
  /** False when Lerno AI is not configured — the pack itself keeps working. */
  aiAvailable?: boolean;
  legacySetId: string | null;
  schoolMethod: {
    publisher: string | null;
    method: string | null;
    edition: string | null;
    chapter: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
  /** Source-grounded analysis of the pack's material (null while unanalyzed). */
  analysis: PackAnalysis | null;
  /** Transparent, rule-based study time estimate in minutes (no AI involved). */
  estimatedStudyTime: number;
  counts: {
    sources: number;
    readySources: number;
    flashcards: number;
    concepts: number;
    practiceQuestions: number;
    tests: number;
  };
  progress: {
    masteryPercent: number;
    dueCards: number;
    studiedCards: number;
    totalCards: number;
    practiceAnswers: number;
    practiceAccuracy: number | null;
    testAttempts: number;
    bestTestScorePercent: number | null;
    weakConcepts: { id: string; name: string }[];
    strongConcepts: { id: string; name: string }[];
    lastActivityAt: string;
  };
  recommended: RecommendedAction;
  sources: StudyPackSource[];
  concepts: StudyPackConcept[];
  studyPlan: StudyPlan | null;
  tests: StudyPackTestSummary[];
  recentAttempts: PackTestAttempt[];
}

export interface PackPracticeQuestion {
  id: string;
  packId: string;
  conceptId: string | null;
  sourceId: string | null;
  prompt: string;
  questionType: QuestionType;
  options: string[] | null;
  explanation: string;
  position: number;
  conceptName: string | null;
  sourceTitle: string | null;
}

export interface PackPracticeQueue {
  packId: string;
  packTitle: string;
  setId: string | null;
  total: number;
  questions: PackPracticeQuestion[];
}

export interface PackPracticeGrade {
  questionId: string;
  verdict: 'correct' | 'partial' | 'incorrect';
  correctAnswer: string;
  explanation: string;
  concept: { id: string; name: string } | null;
  previousMasteryPercent: number | null;
  conceptMasteryPercent: number | null;
  sourceTitle: string | null;
}

export interface PackTestRun {
  test: StudyPackTestSummary;
  questions: PackPracticeQuestion[];
}

export interface PackTestSubmission {
  attempt: PackTestAttempt;
  accuracy: number;
  results: (PackTestAnswerRecord & {
    options: string[] | null;
    verdict: 'correct' | 'partial' | 'incorrect';
    previousMasteryPercent: number | null;
    conceptMasteryPercent: number | null;
  })[];
  strongConcepts: { id: string; name: string }[];
  weakConcepts: { id: string; name: string }[];
  recommended: RecommendedAction;
}

export interface StudyPackProgressOverview {
  packId: string;
  masteryPercent: number;
  dueCards: number;
  studiedCards: number;
  totalCards: number;
  practiceAnswers: number;
  practiceAccuracy: number | null;
  testAttempts: PackTestAttempt[];
  weakConcepts: {
    id: string;
    name: string;
    masteryPercent: number;
    attempts: number;
    sourceTitle: string | null;
  }[];
  strongConcepts: { id: string; name: string; masteryPercent: number }[];
  concepts: {
    id: string;
    name: string;
    masteryPercent: number;
    attempts: number;
    lastPracticedAt: string | null;
  }[];
  recommended: RecommendedAction;
}

export interface StudyPackTodayTask {
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
  packId: string | null;
  conceptId: string | null;
  conceptName: string | null;
}

export interface StudyPackToday {
  date: string;
  recommended?: StudyPackTodayTask;
  tasks: StudyPackTodayTask[];
  exams: {
    packId: string;
    title: string;
    examDate: string | null;
    daysLeft: number | null;
    masteryPercent: number;
    weakConcepts: number;
    dueCards: number;
  }[];
  totalDue: number;
  packs: StudyPackSummary[];
}

export interface PackReviewSummary {
  cardsDue: number;
  conceptsDue: number;
  testsToReview: number;
  packsNeedingReview: {
    packId: string | null;
    title: string;
    dueCount: number;
    nextReviewAt: string | null;
  }[];
  weakConceptPacks: {
    packId: string;
    packTitle: string;
    weakConcepts: number;
    masteryPercent: number;
  }[];
  weakConceptCount: number;
  packs: StudyPackSummary[];
}

/* --------------------------- editable AI previews -------------------------- */

export interface PackSummaryPreview {
  target: 'summary';
  title: string;
  summary: string;
  keyPoints: string[];
  terms: { term: string; definition: string }[];
  sourceId: string | null;
}

export interface PackConceptsPreview {
  target: 'concepts';
  concepts: { name: string; explanation: string; sourceId: string | null }[];
}

export interface PackCardsPreview {
  target: 'flashcards';
  title: string;
  description: string;
  cards: { front: string; back: string }[];
  sourceId: string | null;
}

export interface PackQuestionsPreview {
  target: 'practice';
  questions: {
    questionType: QuestionType;
    prompt: string;
    correctAnswer: string;
    options: string[] | null;
    explanation: string;
    sourceId: string | null;
  }[];
}

export type PackPreview =
  | PackSummaryPreview
  | PackConceptsPreview
  | PackCardsPreview
  | PackQuestionsPreview;

export interface PackTutorReply {
  reply: string;
}

/* ----------------------- material import (ingestion) ----------------------- */

export interface MaterialConceptCandidate {
  name: string;
  /** The sentence the candidate was found in — never a generated definition. */
  explanation: string;
}

/** What Lerno really found in an uploaded PDF, before anything is created. */
export interface MaterialPdfPreview {
  title: string;
  text: string;
  pageCount: number;
  wordCount: number;
  characterCount: number;
  truncated: boolean;
  concepts: MaterialConceptCandidate[];
}

export type ImportStageId = 'extract' | 'normalize' | 'analyze' | 'generate' | 'review' | 'plan';

export type ImportStepState = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export interface ImportProcessingStep {
  id: ImportStageId;
  label: string;
  state: ImportStepState;
}

/** One source of a pack, with its own lifecycle state and retry affordance. */
export interface ImportSourceStatus {
  id: string;
  title: string;
  kind: PackSourceKind;
  status: PackSourceStatus;
  stage: string | null;
  failureReason: string | null;
  referenceLabel: string | null;
  retryable: boolean;
  /** Canonical source URL (YouTube); null for everything else. */
  url: string | null;
}

/**
 * Real processing state of one import. `processing` is true while the backend
 * is still working; the steps are what actually ran, never a timer.
 */
export interface ImportProcessingStatus {
  packId: string;
  status: 'processing' | 'ready' | 'partial' | 'failed';
  stage: ImportStageId | null;
  stageLabel: string | null;
  steps: ImportProcessingStep[];
  aiAvailable: boolean;
  aiSkipped: boolean;
  counts: {
    concepts: number;
    flashcards: number;
    practiceQuestions: number;
    hasSummary: boolean;
    hasPlan: boolean;
    hasAnalysis: boolean;
    /** Sources in the pack, and how many of them are ready to study from. */
    sources: number;
    readySources: number;
    conflicts: number;
    rejected: number;
  };
  failure: { stage: ImportStageId | null; message: string; details: string | null } | null;
  processing: boolean;
  /** Every source of this pack, so the UI can retry exactly the failed one. */
  sources: ImportSourceStatus[];
  estimatedMinutes: number | null;
  estimatedStudyTimeLabel: string | null;
  /** True when the pack has material the student can actually study. */
  ready: boolean;
}

export interface ImportStarted {
  packId: string;
  jobId: string;
  status: ImportProcessingStatus;
}

/** The three knobs a student gets over generation (kept deliberately small). */
export interface GenerationSettings {
  flashcards: number;
  practice: number;
  difficulty: 'easy' | 'medium' | 'hard';
  language: 'nl' | 'en';
}

export interface SourceConflictClaim {
  statement: string;
  sourceId: string;
  marker: string;
  referenceLabel: string;
  /** Short quote verified against the source text. */
  quote: string;
}

/** Two sources that say different things — Lerno never merges them silently. */
export interface SourceConflict {
  topic: string;
  explanation: string;
  claims: SourceConflictClaim[];
}

/** The stored, source-grounded analysis every generation reuses. */
export interface PackAnalysis {
  summary: string;
  keyFacts: string[];
  relationships: string[];
  examTopics: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  sections: { title: string; marker: string }[];
  conflicts: SourceConflict[];
  sourceIds: string[];
  createdAt: string;
}

export interface RejectedContentItem {
  kind: 'summary' | 'concept' | 'flashcard' | 'question';
  index: number;
  reason: string;
  /** Short, student-readable explanation. */
  detail: string;
}

/** The full, editable review bundle: everything the review screen shows at once. */
export interface StudyContentPreview {
  packId: string;
  settings: GenerationSettings;
  summary: { title: string; summary: string; keyPoints: string[]; sourceId: string | null } | null;
  concepts: {
    name: string;
    explanation: string;
    sourceId: string;
    refLabel: string | null;
    importance: number | null;
    difficulty: 'easy' | 'medium' | 'hard' | null;
  }[];
  flashcards: {
    front: string;
    back: string;
    refLabel: string | null;
    sourceId: string | null;
    conceptId: string | null;
  }[];
  questions: {
    questionType: QuestionType;
    prompt: string;
    correctAnswer: string;
    options: string[] | null;
    explanation: string;
    sourceId: string | null;
    refLabel: string | null;
    conceptId: string | null;
  }[];
  rejected: RejectedContentItem[];
  analysis: PackAnalysis | null;
  conflicts: SourceConflict[];
}

export type RegeneratableKind = 'flashcard' | 'question' | 'concept';

export interface RegeneratedItem {
  kind: RegeneratableKind;
  item:
    | { front: string; back: string; refLabel: string | null; sourceId: string | null; conceptId: string | null }
    | {
        questionType: QuestionType;
        prompt: string;
        correctAnswer: string;
        options: string[] | null;
        explanation: string;
        sourceId: string | null;
        refLabel: string | null;
        conceptId: string | null;
      }
    | {
        name: string;
        explanation: string;
        sourceId: string;
        refLabel: string | null;
        importance: number | null;
        difficulty: 'easy' | 'medium' | 'hard' | null;
      };
}

/** Existing material the duplicate check found (409 CONFLICT details). */
export interface DuplicateMaterialRef {
  reason: 'duplicate-source';
  packId: string;
  packTitle: string;
  sourceId: string;
  sourceTitle: string;
}
