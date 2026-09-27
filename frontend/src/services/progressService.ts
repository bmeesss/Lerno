import { api } from '../lib/api';
import type { ProgressStats } from '../types';

export const progressService = {
  get: () => api.get<ProgressStats>('/progress'),
};
