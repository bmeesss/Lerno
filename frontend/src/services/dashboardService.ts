import { api } from '../lib/api';
import type { DashboardData } from '../types';

export const dashboardService = {
  get: () => api.get<DashboardData>('/dashboard'),
};
