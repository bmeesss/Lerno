import { api } from '../lib/api';
import type {
  PackCardsPreview,
  PackConceptsPreview,
  PackPracticeGrade,
  PackPracticeQueue,
  PackQuestionsPreview,
  PackSummaryPreview,
  PackTestRun,
  PackTestSubmission,
  PackTutorReply,
  PackReviewSummary,
  QuestionType,
  StudyPackConcept,
  StudyPackDetail,
  StudyPackProgressOverview,
  StudyPackSource,
  StudyPackSummary,
  StudyPackToday,
  StudyPlan,
  Visibility,
} from '../types';

export interface CreateStudyPackInput {
  title: string;
  subjectId?: string | null;
  description?: string;
  level?: string;
  visibility?: Visibility;
  examDate?: string | null;
  source?:
    | { type: 'text' | 'pdf'; title: string; text: string; pageCount?: number }
    | { type: 'set'; setId: string; title?: string };
  cards?: { question: string; answer: string }[];
}

export interface AddSourceInput {
  type: 'text' | 'pdf' | 'set';
  title?: string;
  text?: string;
  pageCount?: number;
  setId?: string;
}

export type GenerateTarget = 'summary' | 'concepts' | 'flashcards' | 'practice';

export interface PracticeQuestionInput {
  questionType: QuestionType;
  prompt: string;
  correctAnswer: string;
  options: string[] | null;
  explanation: string;
}

export type ApplyContentInput =
  | { target: 'summary'; summary: string; sourceId: string | null }
  | { target: 'concepts'; concepts: { name: string; explanation: string }[]; sourceId: string | null }
  | { target: 'flashcards'; cards: { front: string; back: string }[]; sourceId: string | null }
  | { target: 'practice'; questions: PracticeQuestionInput[]; sourceId: string | null };

export type ApplyContentResult =
  | { summary: string | null; summarySourceId: string | null }
  | { added: number; skipped: number; concepts: StudyPackConcept[] }
  | { added: number; cards: { id: string; question: string; answer: string; position: number }[] }
  | { added: number; questions: { id: string; prompt: string }[] };

/** Study Pack API — one place for every pack request (no fetch in components). */
export const studyPackService = {
  list: () => api.get<StudyPackSummary[]>('/study-packs'),

  today: () => api.get<StudyPackToday>('/study-packs/today'),

  reviewQueue: () => api.get<PackReviewSummary>('/study-packs/review-queue'),

  get: (packId: string) => api.get<StudyPackDetail>(`/study-packs/${packId}`),

  create: (input: CreateStudyPackInput) => api.post<StudyPackDetail>('/study-packs', input),

  update: (
    packId: string,
    patch: Partial<{
      title: string;
      subjectId: string | null;
      description: string;
      level: string;
      visibility: Visibility;
      examDate: string | null;
    }>,
  ) => api.patch<StudyPackSummary>(`/study-packs/${packId}`, patch),

  remove: (packId: string) => api.delete<void>(`/study-packs/${packId}`),

  /* sources */
  addSource: (packId: string, input: AddSourceInput) =>
    api.post<StudyPackSource>(`/study-packs/${packId}/sources`, input),
  removeSource: (packId: string, sourceId: string) =>
    api.delete<void>(`/study-packs/${packId}/sources/${sourceId}`),

  /* concepts */
  createConcept: (packId: string, input: { name: string; explanation: string }) =>
    api.post<StudyPackConcept>(`/study-packs/${packId}/concepts`, input),
  updateConcept: (packId: string, conceptId: string, patch: { name?: string; explanation?: string }) =>
    api.patch<StudyPackConcept>(`/study-packs/${packId}/concepts/${conceptId}`, patch),
  removeConcept: (packId: string, conceptId: string) =>
    api.delete<void>(`/study-packs/${packId}/concepts/${conceptId}`),
  rateConcept: (packId: string, conceptId: string, rating: 'again' | 'hard' | 'good' | 'easy') =>
    api.post<{ conceptId: string; masteryPercent: number; attempts: number; weak: boolean }>(
      `/study-packs/${packId}/concepts/${conceptId}/rating`,
      { rating },
    ),

  /* AI previews + confirmed content */
  generate: (packId: string, target: GenerateTarget, options: { sourceId?: string | null; count?: number } = {}) =>
    api.post<PackSummaryPreview | PackConceptsPreview | PackCardsPreview | PackQuestionsPreview>(
      `/study-packs/${packId}/generate`,
      { target, sourceId: options.sourceId ?? null, count: options.count },
    ),
  applyContent: (packId: string, input: ApplyContentInput) =>
    api.post<ApplyContentResult>(`/study-packs/${packId}/content`, input),

  /* practice */
  practiceQueue: (packId: string, options: { conceptId?: string; limit?: number } = {}) =>
    api.get<PackPracticeQueue>(`/study-packs/${packId}/practice`, options),
  gradePractice: (packId: string, questionId: string, answer: string) =>
    api.post<PackPracticeGrade>(`/study-packs/${packId}/practice/attempts`, { questionId, answer }),

  /* tests */
  createTest: (packId: string, mode: 'quick10' | 'quick20' | 'exam') =>
    api.post<PackTestRun>(`/study-packs/${packId}/tests`, { mode }),
  submitTest: (
    packId: string,
    testId: string,
    answers: { questionId: string; answer: string }[],
  ) => api.post<PackTestSubmission>(`/study-packs/${packId}/tests/${testId}/submit`, { answers }),
  testHistory: (packId: string) =>
    api.get<
      { tests: StudyPackDetail['tests']; attempts: StudyPackDetail['recentAttempts'] }
    >(`/study-packs/${packId}/tests`),

  /* progress, plan and tutor */
  progress: (packId: string) => api.get<StudyPackProgressOverview>(`/study-packs/${packId}/progress`),
  plan: (packId: string) => api.get<StudyPlan | null>(`/study-packs/${packId}/plan`),
  createPlan: (packId: string, options: { days?: number; minutesPerDay?: number } = {}) =>
    api.post<StudyPlan>(`/study-packs/${packId}/plan`, options),
  tutor: (packId: string, message: string, history: { role: 'user' | 'assistant'; content: string }[]) =>
    api.post<PackTutorReply>(`/study-packs/${packId}/tutor`, { message, history }),
};
