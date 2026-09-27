import { api } from '../lib/api';
import type { Subject } from '../types';

export const subjectService = {
  list: () => api.get<Subject[]>('/subjects'),
  create: (name: string) => api.post<Subject>('/subjects', { name }),
  rename: (subjectId: string, name: string) =>
    api.patch<Subject>(`/subjects/${subjectId}`, { name }),
  remove: (subjectId: string) => api.delete<void>(`/subjects/${subjectId}`),
};
