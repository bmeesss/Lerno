import { api } from '../lib/api';
import type { CardProgress, DueGroup, ReviewResult, StudySession } from '../types';

export interface PracticeCardEntry {
  card: { id: string; question: string; answer: string; position: number };
  reason: 'due' | 'incorrect' | 'difficult' | 'new';
}

export interface PracticeQueue {
  setId: string;
  title: string;
  cards: PracticeCardEntry[];
}

export interface ReviewResponse {
  progress: CardProgress;
  requeued: boolean;
}

export const studyService = {
  review: (setId: string, cardId: string, result: ReviewResult) =>
    api.post<ReviewResponse>('/study/review', { setId, cardId, result }),
  practiceQueue: (setId: string) => api.get<PracticeQueue>(`/study/practice/${setId}`),
  startSession: (setId: string) => api.post<StudySession>('/study/sessions', { setId }),
  endSession: (sessionId: string, cardsSeen: number) =>
    api.patch<StudySession>(`/study/sessions/${sessionId}`, { cardsSeen }),
  dueGroups: () => api.get<DueGroup[]>('/reviews'),
};
