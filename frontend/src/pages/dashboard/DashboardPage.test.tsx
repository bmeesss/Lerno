import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardService } from '../../services/dashboardService';
import { studyPackService } from '../../services/studyPackService';
import type { DashboardData, StudyPackToday, StudySetSummary } from '../../types';
import { DashboardPage } from './DashboardPage';

vi.mock('../../services/dashboardService', () => ({
  dashboardService: { get: vi.fn() },
}));
vi.mock('../../services/studyPackService', () => ({ studyPackService: { today: vi.fn() } }));

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: { user: null as unknown },
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockAuth,
}));

const getMock = vi.mocked(dashboardService.get);
const todayMock = vi.mocked(studyPackService.today);

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
  todayMock.mockRejectedValue(new Error('Adaptive recommendation unavailable'));
});

describe('DashboardPage', () => {
  it('uses the shared adaptive recommendation and its reason on the dashboard', async () => {
    const recommendation = {
      type: 'practice' as const,
      label: 'Practice Osmosis',
      description: 'You answered 3 questions incorrectly recently.',
      packId: 'pack-1',
      conceptId: 'concept-1',
      conceptName: 'Osmosis',
    };
    const adaptive: StudyPackToday = {
      date: '2026-09-29',
      recommended: recommendation,
      tasks: [recommendation],
      exams: [],
      totalDue: 0,
      packs: [],
    };
    todayMock.mockResolvedValue(adaptive);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Practice Osmosis' })).toBeInTheDocument();
    expect(screen.getByText('You answered 3 questions incorrectly recently.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start practice/i })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=practice&concept=concept-1',
    );
  });

  it('prioritizes a study action and today, then library and review', async () => {
    renderPage();
    const headings = await screen.findAllByRole('heading', { level: 2 });
    const names = headings.map((heading) => heading.textContent);
    expect(names).toEqual([
      'Keep your curiosity going.',
      'Today',
      'Your recent sets',
      'Up next',
      'A little more to explore',
    ]);
  });

  it('links suggestions to their sets and discover to the full list', async () => {
    renderPage();
    const suggestion = await screen.findByRole('link', { name: /photosynthesis/i });
    expect(suggestion.getAttribute('href')).toBe('/sets/set-9');
    expect(screen.getByRole('link', { name: 'Discover sets' })).toHaveAttribute(
      'href',
      '/discover',
    );
    expect(screen.getByRole('link', { name: 'Continue studying' })).toHaveAttribute(
      'href',
      '/sets/set-1/study',
    );
  });

  it('keeps actionable library and review empty states without invented activity', async () => {
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
    expect(screen.getByRole('heading', { name: 'Your learning starts here' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a study set' })).toHaveAttribute(
      'href',
      '/sets/new',
    );
  });
});
