import { api } from '../lib/api';
import type { ProgressStats, TodaySummary, WeekSummary } from '../types';

export const progressService = {
  get: () => api.get<ProgressStats>('/progress'),
  today: () => api.get<TodaySummary>('/progress/today'),
  week: () => api.get<WeekSummary>('/progress/week'),
};
