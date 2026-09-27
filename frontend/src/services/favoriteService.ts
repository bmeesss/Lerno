import { api } from '../lib/api';
import type { StudySetSummary } from '../types';

export const favoriteService = {
  list: () => api.get<StudySetSummary[]>('/favorites'),
  add: (setId: string) => api.post<void>(`/favorites/${setId}`),
  remove: (setId: string) => api.delete<void>(`/favorites/${setId}`),
};
