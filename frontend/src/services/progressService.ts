import { api } from '../lib/api';
import type { ProgressStats, StudyProgressOverview, TodaySummary, WeekSummary } from '../types';

export const progressService = {
  get: () => api.get<ProgressStats>('/progress'),
  today: () => api.get<TodaySummary>('/progress/today'),
  week: () => api.get<WeekSummary>('/progress/week'),
  /** Everything the Progress page shows, in one request (real study data only). */
  study: () => api.get<StudyProgressOverview>('/progress/study'),
};
