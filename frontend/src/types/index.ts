/** Shared domain types mirroring the API (see docs/LERNO_SPEC.md §12). */

export type Visibility = 'private' | 'public';

export type Role = 'user' | 'admin';

export type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer';

export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
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
  quizAttempts: number;
  accuracy: number | null;
  studyTimeMinutes: number;
  streakDays: number;
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
