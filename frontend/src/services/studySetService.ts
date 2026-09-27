import { api } from '../lib/api';
import type { Card, StudySetDetail, StudySetSummary, Visibility } from '../types';

export interface CreateSetInput {
  title: string;
  subjectId: string | null;
  level: string;
  description: string;
  visibility: Visibility;
  tags: string[];
  cards?: { question: string; answer: string }[];
}

export type UpdateSetInput = Partial<Omit<CreateSetInput, 'cards'>>;

export const studySetService = {
  listMine: () => api.get<StudySetSummary[]>('/sets'),
  get: (setId: string) => api.get<StudySetDetail>(`/sets/${setId}`),
  create: (input: CreateSetInput) => api.post<StudySetDetail>('/sets', input),
  update: (setId: string, patch: UpdateSetInput) =>
    api.patch<StudySetSummary>(`/sets/${setId}`, patch),
  remove: (setId: string) => api.delete<void>(`/sets/${setId}`),

  addCards: (setId: string, cards: { question: string; answer: string }[]) =>
    api.post<Card[]>(`/sets/${setId}/cards`, { cards }),
  updateCard: (setId: string, cardId: string, patch: { question?: string; answer?: string }) =>
    api.patch<Card>(`/sets/${setId}/cards/${cardId}`, patch),
  removeCard: (setId: string, cardId: string) => api.delete<void>(`/sets/${setId}/cards/${cardId}`),
};
