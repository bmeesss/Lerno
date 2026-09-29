import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardService } from '../../services/dashboardService';
import { studyService } from '../../services/studyService';
import { studyPackService } from '../../services/studyPackService';
import { studySetService } from '../../services/studySetService';
import { subjectService } from '../../services/subjectService';
import { packSummary, resumeCard, step, today } from '../../test-fixtures/study';
import type { DashboardData, StudyPackToday, StudySetSummary, SubjectToday } from '../../types';
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
    date: '2026-09-29',
    target: 10,
    completedCards: 0,
    completionPercentage: 0,
    goalReached: false,
    cardsDue: 0,
    upcoming: { dueNow: 0, laterToday: 0, tomorrow: 0, next7Days: 0 },
    streak: { current: 1, longest: 3, lastActiveDay: '2026-09-28' },
    comeback: null,
    continueAction: { type: 'create-set' },
  },
  suggestions: [],
};

const SET = { id: 'set-1', title: 'Cells', cardCount: 4 } as unknown as StudySetSummary;

function renderPage() {
  return render(
    <MemoryRouter>
      <MyStudyPage />
    </MemoryRouter>,
  );
}

/** The page has exactly one primary action; everything else is secondary or quiet. */
function primaryActions(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.btn-primary')];
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

describe('My Study — today', () => {
  it('opens with how long today is, the recommended next step and why', async () => {
    renderPage();

    const section = (await screen.findByRole('heading', { level: 2, name: 'Today' })).closest('section')!;
    expect(within(section).getByText('You have 25 minutes planned.')).toBeInTheDocument();
    expect(within(section).getByText('25 min recommended')).toBeInTheDocument();

    expect(within(section).getByText('Recommended next')).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: 'Practice Osmosis' })).toBeInTheDocument();
    expect(within(section).getAllByText('You missed 3 recent questions.').length).toBeGreaterThan(0);
  });

  it('has exactly one primary action, matching the recommended step', async () => {
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Practice Osmosis' });

    const primary = primaryActions(container);
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent('Start practice');
    expect(primary[0]).toHaveAttribute('href', '/study-packs/pack-1?tab=practice&concept=c1');
  });

  it('lists the plan as numbered steps, each with a secondary action', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: 'Your plan' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);

    expect(within(items[0]!).getByText('Practice Osmosis')).toBeInTheDocument();
    expect(within(items[0]!).getByText('1')).toBeInTheDocument();
    expect(within(items[0]!).getByRole('link', { name: 'Start practice: Practice Osmosis' })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=practice&concept=c1',
    );

    // The pack title the engine appends to the label is shown separately.
    expect(within(items[1]!).getByText('Review 8 cards')).toBeInTheDocument();
    expect(within(items[1]!).getByText('8 cards are due today.')).toBeInTheDocument();
    expect(within(items[1]!).getByRole('link', { name: 'Review cards: Review 8 cards' })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=flashcards',
    );

    expect(within(items[2]!).getByText('Prepare for a test')).toBeInTheDocument();
    expect(within(items[2]!).getByRole('link', { name: /Start test/ })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=test&mode=quick10',
    );
  });

  it('shows the exam countdown and says the plan was adjusted', async () => {
    todayMock.mockResolvedValue(
      today({
        exam: {
          packId: 'pack-1',
          title: 'Biology',
          examDate: '2026-10-08',
          daysLeft: 9,
          message: 'Biology exam in 9 days',
          note: 'Your plan is adjusted for the exam.',
        },
      }),
    );
    renderPage();
    const banner = await screen.findByRole('region', { name: 'Upcoming exam' });
    expect(within(banner).getByText('Biology exam in 9 days')).toBeInTheDocument();
    expect(within(banner).getByText('Your plan is adjusted for the exam.')).toBeInTheDocument();
    expect(within(banner).getByRole('link', { name: /view pack/i })).toHaveAttribute('href', '/study-packs/pack-1');
  });

  it('shows no exam banner without an exam', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Practice Osmosis' });
    expect(screen.queryByRole('region', { name: 'Upcoming exam' })).not.toBeInTheDocument();
  });

  it('offers to continue where the student left off, and that is then the only primary action', async () => {
    todayMock.mockResolvedValue(today({ resume: [resumeCard()] }));
    const { container } = renderPage();

    const hero = (await screen.findByRole('heading', { name: 'Biology Practice' })).closest('article')!;
    expect(within(hero).getByText('Continue where you left off')).toBeInTheDocument();
    expect(within(hero).getByText('Question 6 of 10')).toBeInTheDocument();
    expect(within(hero).getByRole('link', { name: /^continue/i })).toHaveAttribute('href', '/study/sessions/s1');
    expect(screen.queryByText('Recommended next')).not.toBeInTheDocument();
    expect(primaryActions(container)).toHaveLength(1);
  });

  it('lists other unfinished sessions as quiet secondary actions', async () => {
    todayMock.mockResolvedValue(
      today({
        resume: [resumeCard(), resumeCard({ sessionId: 's2', label: 'Maths Learn', positionLabel: 'Concept 2 of 5' })],
      }),
    );
    const { container } = renderPage();
    const others = await screen.findByRole('list', { name: 'Other unfinished sessions' });
    expect(within(others).getByText('Maths Learn')).toBeInTheDocument();
    expect(within(others).getByRole('link', { name: 'Continue Maths Learn' })).toHaveAttribute('href', '/study/sessions/s2');
    expect(primaryActions(container)).toHaveLength(1);
  });

  it('shows a light streak only when there is one', async () => {
    todayMock.mockResolvedValue(today({ streak: { current: 3, longest: 5, lastActiveDay: '2026-09-28', todayDone: false } }));
    const { unmount } = renderPage();
    expect(await screen.findByText('3 day study streak')).toBeInTheDocument();
    unmount();

    todayMock.mockResolvedValue(today({ streak: { current: 0, longest: 0, lastActiveDay: null, todayDone: false } }));
    renderPage();
    await screen.findByRole('heading', { name: 'Practice Osmosis' });
    expect(screen.queryByText(/day study streak/)).not.toBeInTheDocument();
  });

  it('says so when nothing needs attention, instead of inventing a plan', async () => {
    todayMock.mockResolvedValue(today({ plan: { budgetMinutes: 25, minutes: 0, steps: [], adjustedForExam: false }, tasks: [], primary: null, recommended: undefined }));
    renderPage();
    expect(await screen.findByText('Nothing is planned yet.')).toBeInTheDocument();
    expect(screen.getByText(/Nothing needs your attention right now/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Your plan' })).not.toBeInTheDocument();
  });
});

describe('My Study — several subjects', () => {
  const subject = (name: string, overrides: Partial<SubjectToday> = {}): SubjectToday => ({
    subjectId: `sub-${name}`,
    subjectName: name,
    packs: 1,
    masteryPercent: 50,
    dueCards: 0,
    weakConcepts: 0,
    examDaysLeft: null,
    minutes: 10,
    steps: [],
    next: step({ label: `Practice ${name}`, packId: `pack-${name}`, packTitle: name, subjectName: name, conceptId: null, conceptName: null, count: 10 }),
    ...overrides,
  });

  it('shows one line per subject, in the order the engine chose — never by name', async () => {
    todayMock.mockResolvedValue(
      today({
        subjects: [
          subject('Wiskunde', { dueCards: 14, examDaysLeft: 4 }),
          subject('Biologie', { weakConcepts: 3 }),
          subject('Engels'),
        ],
      }),
    );
    renderPage();

    const section = (await screen.findByRole('heading', { name: 'By subject' })).closest('section')!;
    const headings = within(section).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    // Not alphabetical and not a fixed subject order: exactly what the server ranked.
    expect(headings).toEqual(['Wiskunde', 'Biologie', 'Engels']);
    const first = within(section).getAllByRole('listitem')[0]!;
    expect(within(first).getByText('14 due', { exact: false })).toBeInTheDocument();
    expect(within(first).getByText(/Exam in 4 days/)).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Wiskunde' })).toHaveAttribute('href', '/subjects/sub-Wiskunde');
    expect(within(first).getByRole('link', { name: 'Start practice: Wiskunde' })).toHaveAttribute(
      'href',
      '/study-packs/pack-Wiskunde?tab=practice',
    );
  });

  it('keeps the subject rows secondary: still only one primary action', async () => {
    todayMock.mockResolvedValue(today({ subjects: [subject('Wiskunde'), subject('Biologie')] }));
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'By subject' });
    expect(primaryActions(container)).toHaveLength(1);
  });

  it('does not repeat the plan as a subject list when there is only one subject', async () => {
    todayMock.mockResolvedValue(today({ subjects: [subject('Biologie')] }));
    renderPage();
    await screen.findByRole('heading', { name: 'Practice Osmosis' });
    expect(screen.queryByRole('heading', { name: 'By subject' })).not.toBeInTheDocument();
  });
});

describe('My Study — older servers and failures', () => {
  it('still works with a response that only has tasks (no plan, no exam banner, no resume)', async () => {
    const first = step();
    const legacy: StudyPackToday = {
      date: '2026-09-29',
      recommended: first,
      tasks: [first],
      exams: [],
      totalDue: 0,
      packs: [packSummary({ masteryPercent: 40 })],
    };
    todayMock.mockResolvedValue(legacy);
    const { container } = renderPage();

    expect(await screen.findByRole('heading', { name: 'Practice Osmosis' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start practice: Practice Osmosis' })).toBeInTheDocument();
    expect(primaryActions(container)).toHaveLength(1);
    // The minutes come from the task itself.
    expect(screen.getByText('You have 4 minutes planned.')).toBeInTheDocument();
  });

  it('keeps My Study usable and offers a retry when the plan cannot be loaded', async () => {
    todayMock.mockRejectedValueOnce(new Error('offline'));
    setsMock.mockResolvedValue([SET]);
    const user = userEvent.setup();
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We could not load your plan for today. Your progress is safe.');
    expect(screen.getByRole('heading', { name: 'My study material' })).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(todayMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Practice Osmosis' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a retry when My Study itself cannot load', async () => {
    dashboardMock.mockRejectedValueOnce(new Error('Server down'));
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Could not load My Study' })).toBeInTheDocument();
    expect(screen.getByText('Server down')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Practice Osmosis' })).toBeInTheDocument();
  });

  it('falls back to the long-standing next action when the planner has nothing', async () => {
    todayMock.mockResolvedValue({ date: '2026-09-29', tasks: [], exams: [], totalDue: 0, packs: [packSummary()] });
    dueGroupsMock.mockResolvedValue([
      { setId: 'set-1', setTitle: 'Cells', subjectName: 'Biologie', dueCount: 6 } as never,
    ]);
    renderPage();
    expect(await screen.findByText('6 cards are ready for review across your study packs.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start studying/i })).toBeInTheDocument();
  });
});

describe('My Study — packs, material and first run', () => {
  it('offers a brand new pack with honest 0% progress and a secondary start', async () => {
    todayMock.mockResolvedValue(today({ packs: [packSummary()] }));
    const { container } = renderPage();

    const section = (await screen.findByRole('heading', { name: 'Your study packs' })).closest('section')!;
    const card = within(section).getByRole('heading', { name: 'Biology H3' }).closest('article')!;
    expect(within(card).getByText(/0% mastered/)).toBeInTheDocument();
    expect(within(card).getByText('Nothing studied yet')).toBeInTheDocument();
    const start = within(card).getByRole('link', { name: 'Start learning' });
    expect(start).toHaveAttribute('href', '/study-packs/pack-1?tab=learn');
    expect(start).not.toHaveClass('btn-primary');
    expect(primaryActions(container)).toHaveLength(1);
  });

  it('continues the pack the student already worked on, with its exam countdown', async () => {
    todayMock.mockResolvedValue(
      today({
        packs: [packSummary({ masteryPercent: 40, dueCards: 3, weakConcepts: 2, lastStudiedAt: '2026-09-28T10:00:00.000Z', examDaysLeft: 9 })],
      }),
    );
    renderPage();
    const card = (await screen.findByRole('heading', { name: 'Biology H3' })).closest('article')!;
    expect(within(card).getByRole('link', { name: 'Continue learning' })).toHaveAttribute('href', '/study-packs/pack-1?tab=learn');
    expect(within(card).getByText('3 due')).toBeInTheDocument();
    expect(within(card).getByText('Exam in 9 days')).toBeInTheDocument();
  });

  it('sends every "Add study material" link to the import experience', async () => {
    setsMock.mockResolvedValue([SET]);
    renderPage();
    const links = await screen.findAllByRole('link', { name: /Add study material/ });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute('href', '/study-packs/new');
  });

  it('shows due flashcards from sets in the review queue, and hides the queue when nothing is due', async () => {
    dueGroupsMock.mockResolvedValue([{ setId: 'set-1', setTitle: 'Cells', subjectName: null, dueCount: 6 } as never]);
    const { unmount } = renderPage();
    const queue = (await screen.findByRole('heading', { name: 'Review queue' })).closest('section')!;
    expect(within(queue).getByRole('link', { name: /Cells/ })).toHaveAttribute('href', '/sets/set-1/study');
    expect(within(queue).getByText('6 due')).toBeInTheDocument();
    unmount();

    dueGroupsMock.mockResolvedValue([]);
    renderPage();
    await screen.findByRole('heading', { name: 'Practice Osmosis' });
    expect(screen.queryByRole('heading', { name: 'Review queue' })).not.toBeInTheDocument();
  });

  it('first run sells the first study pack instead of showing an empty plan', async () => {
    todayMock.mockResolvedValue(today({ packs: [], tasks: [], plan: undefined, primary: null, recommended: undefined }));
    const { container } = renderPage();

    expect(await screen.findByText('Start your first Study Pack')).toBeInTheDocument();
    expect(
      screen.getByText('Upload your notes, import a PDF or paste text and Lerno will turn it into a complete learning system.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No study sets found/i)).not.toBeInTheDocument();
    // The empty state owns the single primary action here; the header one is secondary.
    expect(primaryActions(container)).toHaveLength(1);
    expect(primaryActions(container)[0]).toHaveTextContent('Add study material');
  });

  it('lists subjects so each can be opened', async () => {
    subjectsMock.mockResolvedValue([{ id: 'sub-1', name: 'Biologie', setCount: 2 } as never]);
    renderPage();
    const link = (await screen.findByRole('heading', { name: 'Biologie' })).closest('a')!;
    expect(link).toHaveAttribute('href', '/subjects/sub-1');
  });
});
