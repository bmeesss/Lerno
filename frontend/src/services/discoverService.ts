import { api } from '../lib/api';
import type { DiscoverFilters, Paginated, StudySetSummary } from '../types';

export interface DiscoverFacets {
  subjects: string[];
  levels: string[];
  tags: string[];
}

export interface PublicProfile {
  profile: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    role: string;
    createdAt: string;
  };
  publicSets: StudySetSummary[];
  stats: {
    publicSetCount: number;
    quizAttempts: number;
    quizAccuracy: number | null;
  };
}

export const discoverService = {
  search: (filters: DiscoverFilters) =>
    api.get<Paginated<StudySetSummary>>('/discover', {
      q: filters.q,
      subject: filters.subject,
      level: filters.level,
      tag: filters.tag,
      page: filters.page,
      pageSize: filters.pageSize,
    }),
  facets: () => api.get<DiscoverFacets>('/discover/facets'),
  publicProfile: (userId: string) => api.get<PublicProfile>(`/profile/${userId}`),
};
