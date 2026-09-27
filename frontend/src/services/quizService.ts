import { api } from '../lib/api';
import type { Quiz, QuizAttemptResult } from '../types';

export const quizService = {
  load: (setId: string) => api.get<Quiz>(`/sets/${setId}/quiz`),
  submit: (setId: string, answers: { questionId: string; answer: string }[]) =>
    api.post<QuizAttemptResult>(`/sets/${setId}/quiz/attempts`, { answers }),
};
