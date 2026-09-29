import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardService } from '../../services/dashboardService';
import { studyService } from '../../services/studyService';
import { studyPackService } from '../../services/studyPackService';
import { studySetService } from '../../services/studySetService';
import { subjectService } from '../../services/subjectService';
import type { DashboardData, StudyPackSummary, StudyPackToday } from '../../types';
import { MyStudyPage } from './MyStudyPage';

vi.mock('../../services/dashboardService', () => ({ dashboardService: { get: vi.fn() } }));
vi.mock('../../services/studyService', () => ({ studyService: { dueGroups: vi.fn() } }));
vi.mock('../../services/studySetService', () => ({ studySetService: { listMine: vi.fn() } }));
vi.mock('../../services/subjectService', () => ({ subjectService: { list: vi.fn() } }));
vi.mock('../../services/studyPackService', () => ({ studyPackService: { today: vi.fn() } }));

const { mockAuth } = vi.hoisted(() => ({ mockAuth: { user: null as unknown } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => mockAuth }));

const dashboardMock = vi.mocked(dashboardService.get);
const dueGroupsMock = vi.mocked(studyService.dueGroups);
const setsMock = vi.mocked(studySetService.listMine);
const subjectsMock = vi.mocked(subjectService.list);
const todayMock = vi.mocked(studyPackService.today);

const DASHBOARD: DashboardData = {
  greetingName: 'Sam',
  cardsDue: 0,
  streakDays: 1,
  cardsStudied: 0,
  quizAccuracy: null,
  recentSets: [],
  dueGroups: [],
  subjectProgress: [],
  continueSet: null,
  today: {
    date: '2026-09-27',
    target: 10,
    completedCards: 0,
    completionPercentage: 0,
    goalReached: false,
    cardsDue: 0,
    upcoming: { dueNow: 0, laterToday: 0, tomorrow: 0, next7Days: 0 },
    streak: { current: 1, longest: 3, lastActiveDay: '2026-09-26' },
    comeback: null,
    continueAction: { type: 'create-set' },
  },
  suggestions: [],
};

function pack(overrides: Partial<StudyPackSummary> = {}): StudyPackSummary {
  return {
    id: 'pack-1',
    ownerId: 'u1',
    subjectId: null,
    subjectName: 'Biologie',
    title: 'Biologie H3',
    description: '',
    level: '3 MAVO',
    visibility: 'private',
    examDate: null,
    examDaysLeft: null,
    legacySetId: null,
    sources: 1,
    flashcards: 12,
    concepts: 8,
    practiceQuestions: 6,
    masteryPercent: 0,
    weakConcepts: 0,
    dueCards: 0,
    summaryUpdatedAt: null,
    createdAt: '2026-09-27T09:00:00.000Z',
    updatedAt: '2026-09-27T09:05:00.000Z',
    ...overrides,
  };
}

function today(overrides: Partial<StudyPackToday> = {}): StudyPackToday {
  return { date: '2026-09-27', tasks: [], exams: [], totalDue: 0, packs: [], ...overrides };
}

function renderPage() {
  render(
    <MemoryRouter>
      <MyStudyPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { id: 'u1', profile: { displayName: 'Sam Student' } };
  dashboardMock.mockResolvedValue(DASHBOARD);
  dueGroupsMock.mockResolvedValue([]);
  setsMock.mockResolvedValue([]);
  subjectsMock.mockResolvedValue([]);
  todayMock.mockResolvedValue(today());
});

describe('MyStudyPage', () => {
  it('offers a brand new pack as the next step with honest 0% progress', async () => {
    todayMock.mockResolvedValue(today({ packs: [pack()] }));
    renderPage();

    const section = (await screen.findByRole('heading', { name: 'Your newest study pack' })).closest(
      'section',
    )!;
    const card = within(section).getByRole('heading', { name: 'Biologie H3' }).closest('article')!;
    expect(within(card).getByText(/0% mastered/)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /start learning/i })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=learn',
    );
  });

  it('continues the pack the student already worked on', async () => {
    todayMock.mockResolvedValue(
      today({ packs: [pack({ masteryPercent: 40, dueCards: 3, weakConcepts: 2 })] }),
    );
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Continue studying' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /continue learning/i })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=learn',
    );
    expect(screen.getByText(/3 cards due for review/)).toBeInTheDocument();
  });

  it('lists recently added material with its real counts and activity', async () => {
    todayMock.mockResolvedValue(
      today({
        packs: [
          pack(),
          pack({
            id: 'pack-2',
            title: 'Wiskunde H2',
            subjectName: 'Wiskunde',
            masteryPercent: 25,
            createdAt: '2026-09-20T09:00:00.000Z',
            sources: 2,
            concepts: 4,
            flashcards: 9,
            practiceQuestions: 3,
          }),
        ],
      }),
    );
    renderPage();

    const section = (await screen.findByRole('heading', { name: 'Recently added' })).closest(
      'section',
    )!;
    // The pack with activity is already "continue studying"; this section shows
    // the material that was added most recently but not started yet.
    const card = within(section)
      .getByRole('heading', { name: 'Biologie H3' })
      .closest('article')!;
    expect(
      within(card).getByText(/1 source · 8 concepts · 12 cards · 6 questions/),
    ).toBeInTheDocument();
    expect(within(card).getByText(/^Added /)).toBeInTheDocument();
  });

  it('sends the primary action to the import experience', async () => {
    renderPage();

    const links = await screen.findAllByRole('link', { name: /Add study material/ });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/study-packs/new');
    }
  });

  it('empty state sells the first study pack instead of the database', async () => {
    renderPage();

    expect(await screen.findByText('Start your first Study Pack')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Upload your notes, import a PDF or paste text and Lerno will turn it into a complete learning system.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No study sets found/i)).not.toBeInTheDocument();
  });
});
