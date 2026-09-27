import { api } from '../lib/api';
import type {
  AdminMetrics,
  AdminUser,
  Report,
  ReportStatus,
  ReportTargetType,
  StudySetSummary,
} from '../types';

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total?: number;
}

export const reportService = {
  create: (input: {
    targetType: ReportTargetType;
    targetId: string;
    reason: string;
    details?: string | null;
  }) => api.post<Report>('/reports', input),
};

export const adminService = {
  metrics: () => api.get<AdminMetrics>('/admin/metrics'),
  listReports: (status?: ReportStatus) =>
    api.get<Paged<Report>>('/admin/reports', { status, pageSize: 50 }),
  resolveReport: (reportId: string, status: 'resolved' | 'dismissed') =>
    api.patch<Report>(`/admin/reports/${reportId}`, { status }),
  listUsers: () => api.get<Paged<AdminUser>>('/admin/users', { pageSize: 50 }),
  setRole: (userId: string, role: 'user' | 'admin') =>
    api.patch<{ ok: boolean }>(`/admin/users/${userId}/role`, { role }),
  deleteUser: (userId: string) => api.delete<{ ok: boolean }>(`/admin/users/${userId}`),
  listSets: () => api.get<Paged<StudySetSummary>>('/admin/sets', { pageSize: 50 }),
  moderateSet: (setId: string, action: 'unpublish' | 'restore') =>
    api.patch<{ id: string; title: string; visibility: string }>(`/admin/sets/${setId}/moderate`, {
      action,
    }),
};
