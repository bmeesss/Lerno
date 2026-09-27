import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardService } from '../../services/dashboardService';
import type { DashboardData, StudySetSummary } from '../../types';
import { DashboardPage } from './DashboardPage';

vi.mock('../../services/dashboardService', () => ({
  dashboardService: { get: vi.fn() },
}));

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: { user: null as unknown },
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockAuth,
}));

const getMock = vi.mocked(dashboardService.get);

function set(overrides: Partial<StudySetSummary> = {}): StudySetSummary {
  return {
    id: 'set-1',
    ownerId: 'u1',
    subjectId: null,
    subjectName: 'Biology',
    title: 'Cells',
    slug: 'cells',
    description: 'Cell biology basics',
    level: '',
    visibility: 'private',
    tags: [],
    cardCount: 10,
    authorName: 'Sam',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-09-27T00:00:00.000Z',
    ...overrides,
  };
}

const DATA: DashboardData = {
  greetingName: 'Sam',
  cardsDue: 3,
  streakDays: 2,
  cardsStudied: 12,
  quizAccuracy: 0.5,
  recentSets: [set({ id: 'set-1', title: 'Cells' })],
  dueGroups: [
    {
      setId: 'set-1',
      setTitle: 'Cells',
      subjectName: 'Biology',
      dueCount: 3,
      nextReviewAt: null,
    },
  ],
  subjectProgress: [],
  continueSet: set({ id: 'set-1', title: 'Cells' }),
  today: {
    date: '2026-09-27',
    target: 10,
    completedCards: 4,
    completionPercentage: 40,
    goalReached: false,
    cardsDue: 3,
    upcoming: { dueNow: 3, laterToday: 0, tomorrow: 1, next7Days: 0 },
    streak: { current: 2, longest: 5, lastActiveDay: '2026-09-26' },
    comeback: null,
    continueAction: { type: 'review', setId: 'set-1', setTitle: 'Cells', dueCount: 3 },
  },
  suggestions: [set({ id: 'set-9', title: 'Photosynthesis', ownerId: 'u2' })],
};

function renderPage() {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { id: 'u1', profile: { displayName: 'Sam Student' } };
  getMock.mockResolvedValue(DATA);
});

describe('DashboardPage', () => {
  it('orders sections Today → due → continue → recent → discover', async () => {
    renderPage();
    const headings = await screen.findAllByRole('heading', { level: 2 });
    const names = headings.map((heading) => heading.textContent);
    expect(names).toEqual([
      'Today',
      'Cards due for review',
      'Continue learning',
      'Recent sets',
      'Discover',
    ]);
  });

  it('links suggestions to their sets and discover to the full list', async () => {
    renderPage();
    const suggestion = await screen.findByRole('link', { name: /photosynthesis/i });
    expect(suggestion.getAttribute('href')).toBe('/sets/set-9');
    const seeAll = screen.getAllByRole('link', { name: 'See all' });
    expect(seeAll.some((link) => link.getAttribute('href') === '/discover')).toBe(true);
  });

  it('hides due and discover sections when empty, keeps the continue empty state', async () => {
    getMock.mockResolvedValue({
      ...DATA,
      dueGroups: [],
      recentSets: [],
      suggestions: [],
      continueSet: null,
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cards due for review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recent sets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Discover' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Continue learning' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a study set' })).toHaveAttribute(
      'href',
      '/sets/new',
    );
  });
});
