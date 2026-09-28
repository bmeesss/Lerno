import { api } from '../lib/api';
import type {
  AiExplanation,
  AiGeneratedQuestions,
  AiGeneratedQuiz,
  AiGeneratedSet,
  AiCardActionResult,
  AiEvaluation,
  AiHint,
  AiStudySummary,
  AiStudyFinishInput,
  AiCardAction,
  AiQuizType,
  AiDifficulty,
} from '../types';

/**
 * Lerno AI on the student's own material: set actions, card actions,
 * generation and overhoor mode. The backend always loads and validates the
 * data — the client only sends ids and choices.
 */
export const aiLearningService = {
  explainSet: (setId: string, focus?: string) =>
    api.post<AiExplanation>(`/ai/sets/${setId}/explain`, { focus }),

  summarizeSet: (setId: string, focus?: string) =>
    api.post<AiExplanation>(`/ai/sets/${setId}/summarize`, { focus }),

  generateQuestions: (setId: string, count: 5 | 10 | 15, difficulty: AiDifficulty) =>
    api.post<AiGeneratedQuestions>(`/ai/sets/${setId}/questions`, { count, difficulty }),

  generateQuiz: (
    setId: string,
    count: 5 | 10 | 15,
    types: AiQuizType[],
    difficulty: AiDifficulty,
  ) => api.post<AiGeneratedQuiz>(`/ai/sets/${setId}/quiz`, { count, types, difficulty }),

  generateSet: (prompt: string, cardCount: number, level?: string) =>
    api.post<AiGeneratedSet>('/ai/generate-set', { prompt, cardCount, level }),

  cardAction: (cardId: string, setId: string, action: AiCardAction) =>
    api.post<AiCardActionResult>(`/ai/cards/${cardId}/action`, { setId, action }),

  evaluateAnswer: (input: {
    setId: string;
    cardId?: string;
    question: string;
    expectedAnswer: string;
    answer: string;
  }) => api.post<AiEvaluation>('/ai/study/evaluate', input),

  hint: (input: {
    setId: string;
    cardId?: string;
    question: string;
    expectedAnswer: string;
    hintsGiven: number;
  }) => api.post<AiHint>('/ai/study/hint', input),

  finishStudy: (input: AiStudyFinishInput) => api.post<AiStudySummary>('/ai/study/finish', input),
};
