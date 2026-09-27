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
