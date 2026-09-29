import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { progressService } from '../services/progressService';
import { studyProgress } from '../test-fixtures/study';
import type { ProgressStats, TodaySummary, WeekSummary } from '../types';
import { ProgressPage } from './ProgressPage';

vi.mock('../services/progressService', () => ({
  progressService: { get: vi.fn(), today: vi.fn(), week: vi.fn(), study: vi.fn() },
}));

const getMock = vi.mocked(progressService.get);
const todayMock = vi.mocked(progressService.today);
const weekMock = vi.mocked(progressService.week);
const studyMock = vi.mocked(progressService.study);

const STATS: ProgressStats = {
  cardsStudied: 12,
  correctAnswers: 9,
  incorrectAnswers: 3,
  dueCards: 4,
  quizAttempts: 2,
  accuracy: 0.75,
  quizAccuracy: 0.5,
  studyTimeMinutes: 35,
  streakDays: 3,
  longestStreak: 5,
  lastActiveDay: '2026-09-26',
  subjectProgress: [
    {
      subjectId: 'sub-1',
      subjectName: 'Biology',
      totalCards: 10,
      learnedCards: 6,
      dueCards: 2,
      accuracy: 0.8,
    },
  ],
  setProgress: [
    {
      subjectId: null,
      subjectName: 'Biology',
      setId: 'set-1',
      setTitle: 'Cells',
      totalCards: 10,
      learnedCards: 6,
      dueCards: 2,
      accuracy: 0.8,
    },
  ],
};

const TODAY: TodaySummary = {
  date: '2026-09-27',
  target: 10,
  completedCards: 4,
  completionPercentage: 40,
  goalReached: false,
  cardsDue: 4,
  upcoming: { dueNow: 4, laterToday: 1, tomorrow: 2, next7Days: 0 },
  streak: { current: 3, longest: 5, lastActiveDay: '2026-09-26' },
  comeback: null,
  continueAction: { type: 'review', setId: 'set-1', setTitle: 'Cells', dueCount: 4 },
};

const WEEK: WeekSummary = {
  weekStart: '2026-09-21',
  studyDays: 3,
  cardsStudied: 12,
  quizzesCompleted: 1,
  quizAccuracy: 0.5,
  studyTimeMinutes: 35,
  currentStreak: 3,
  days: [],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ProgressPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockResolvedValue(STATS);
  todayMock.mockResolvedValue(TODAY);
  weekMock.mockResolvedValue(WEEK);
  studyMock.mockResolvedValue(studyProgress());
});

describe('ProgressPage — overview', () => {
  it('shows real numbers: mastery, study time, questions, cards, tests and concepts mastered', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Progress' });

    const stat = (label: string) =>
      screen.getByText(label, { selector: '.stat-label' }).parentElement!;
    expect(stat('Overall mastery')).toHaveTextContent('62%');
    expect(stat('Overall mastery')).toHaveTextContent('Across 40 concepts');
    expect(stat('Study time')).toHaveTextContent('1 h 5 min');
    expect(stat('Questions answered')).toHaveTextContent('132');
    expect(stat('Cards reviewed')).toHaveTextContent('48');
    expect(stat('Tests completed')).toHaveTextContent('3');
    expect(stat('Tests completed')).toHaveTextContent('14 sessions finished');
    expect(stat('Concepts mastered')).toHaveTextContent('12');
    expect(stat('Concepts mastered')).toHaveTextContent('of 40 · 85% or higher');
  });

  it('says "< 1 min" for a few seconds of study, not a misleading "0 min"', async () => {
    studyMock.mockResolvedValue(
      studyProgress({ overall: { ...studyProgress().overall, studySeconds: 20, studyMinutes: 0 } }),
    );
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Progress' });
    expect(
      screen.getByText('Study time', { selector: '.stat-label' }).parentElement,
    ).toHaveTextContent('< 1 min');
  });

  it('reports recent improvement and a streak made of finished sessions', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Progress' });
    const improvement = screen.getByText('Recent improvement', {
      selector: '.stat-label',
    }).parentElement!;
    expect(improvement).toHaveTextContent('+8 pts');
    expect(improvement).toHaveTextContent('Mastery over the last 7 days');
    const streak = screen.getByText('Study streak', { selector: '.stat-label' }).parentElement!;
    expect(streak).toHaveTextContent('3 days');
    expect(streak).toHaveTextContent('Best 5 days · finished sessions only');
  });

  it('lists the concepts that improved, old to new', async () => {
    renderPage();
    const improved = (await screen.findByRole('heading', { name: 'Improved recently' })).closest(
      'section',
    )!;
    expect(within(improved).getByText('Osmosis')).toBeInTheDocument();
    expect(within(improved).getByText('42% → 61%')).toBeInTheDocument();
  });

  it('does not invent an improvement it cannot measure', async () => {
    studyMock.mockResolvedValue(
      studyProgress({
        overall: { ...studyProgress().overall, recentImprovement: null, improvedConcepts: [] },
        streak: { current: 0, longest: 0, lastActiveDay: null, todayDone: false },
      }),
    );
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Progress' });
    const improvement = screen.getByText('Recent improvement', {
      selector: '.stat-label',
    }).parentElement!;
    expect(improvement).toHaveTextContent('—');
    expect(improvement).toHaveTextContent('Shown after 3 days of study');
    expect(screen.queryByRole('heading', { name: 'Improved recently' })).not.toBeInTheDocument();
    expect(screen.getByText('Finish a session to start one')).toBeInTheDocument();
  });

  it('has one primary action once there is something to continue', async () => {
    const { container } = renderPage();
    expect(await screen.findByRole('link', { name: 'Continue studying' })).toHaveAttribute(
      'href',
      '/study',
    );
    expect(container.querySelectorAll('.btn-primary')).toHaveLength(1);
  });
});

describe('ProgressPage — study packs', () => {
  it('shows per pack: mastery, a real trend, weak and strong concepts and activity', async () => {
    renderPage();
    const pack = (await screen.findByRole('link', { name: 'Biology H3' })).closest('li')!;

    expect(within(pack).getByText('Biology')).toBeInTheDocument();
    expect(within(pack).getByRole('progressbar', { name: 'Mastery mastery' })).toHaveAttribute(
      'aria-valuenow',
      '62',
    );
    expect(within(pack).getByText('Exam in 9 days')).toBeInTheDocument();
    expect(within(pack).getByText('4 due')).toBeInTheDocument();

    // Weak concepts are a way into practice; strong ones are just recognition.
    expect(within(pack).getByRole('link', { name: 'Practice Diffusion (18%)' })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=practice&concept=c2',
    );
    const strong = within(pack).getByText('You know well').parentElement!;
    expect(within(strong).getByText('Osmosis')).toBeInTheDocument();

    const facts = within(pack).getByText('Sessions').closest('dl')!;
    expect(facts).toHaveTextContent('9');
    expect(facts).toHaveTextContent('88');
    expect(facts).toHaveTextContent('4 of 7');
  });

  it('draws the trend only when there are enough real days', async () => {
    renderPage();
    const chart = await screen.findByRole('img', { name: /Mastery trend: 48% on .* to 62% on / });
    expect(chart).toBeInTheDocument();
    expect(screen.getByText(/Up 14 points since/)).toBeInTheDocument();
  });

  it('says why there is no trend yet, instead of drawing a flat fake line', async () => {
    const base = studyProgress();
    studyMock.mockResolvedValue(
      studyProgress({
        packs: [
          {
            ...base.packs[0]!,
            trend: {
              hasEnoughData: false,
              daysRecorded: 1,
              minDays: 3,
              points: [{ day: '2026-09-29', masteryPercent: 62 }],
              changePercent: null,
              direction: null,
            },
          },
        ],
      }),
    );
    renderPage();
    expect(
      await screen.findByText('A trend appears after 3 days of study — 1 so far.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('says so when there are no weak or strong concepts', async () => {
    const base = studyProgress();
    studyMock.mockResolvedValue(
      studyProgress({
        packs: [{ ...base.packs[0]!, weakConcepts: [], strongConcepts: [], lastActivityAt: null }],
      }),
    );
    renderPage();
    expect(await screen.findByText('No weak concepts.')).toBeInTheDocument();
    expect(screen.getByText('Nothing above 85% yet.')).toBeInTheDocument();
    expect(screen.getByText('Not studied yet')).toBeInTheDocument();
  });
});

describe('ProgressPage — empty and error states', () => {
  it('shows an honest empty state, with no stat cards or charts, before any study', async () => {
    studyMock.mockResolvedValue(
      studyProgress({
        hasActivity: false,
        overall: {
          ...studyProgress().overall,
          masteryPercent: null,
          studyMinutes: 0,
          studySeconds: 0,
          questionsAnswered: 0,
          cardsReviewed: 0,
          testsCompleted: 0,
          sessionsCompleted: 0,
          conceptsMastered: 0,
          recentImprovement: null,
          improvedConcepts: [],
        },
      }),
    );
    const { container } = renderPage();
    expect(await screen.findByRole('heading', { name: 'No study data yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start studying' })).toHaveAttribute('href', '/study');
    expect(screen.queryByText('Overall mastery')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.stat-card')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Continue studying' })).not.toBeInTheDocument();
  });

  it('offers a retry when progress cannot be loaded', async () => {
    studyMock.mockRejectedValueOnce(new Error('Server down'));
    const user = userEvent.setup();
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Could not load progress' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Server down')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Progress' })).toBeInTheDocument();
    expect(screen.getByText('Overall mastery', { selector: '.stat-label' })).toBeInTheDocument();
  });
});

describe('ProgressPage — flashcards and quizzes', () => {
  it('keeps labelling flashcard accuracy explicitly and shows the today strip', async () => {
    renderPage();
    expect(await screen.findByText('Flashcard accuracy')).toBeInTheDocument();
    expect(
      await screen.findByText('Quiz accuracy', { selector: '.stat-label' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/80% card accuracy/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByLabelText('4 / 10 cards')).toBeInTheDocument();
  });

  it('shows the set progress of the flashcard side', async () => {
    renderPage();
    const set = (await screen.findByText('Cells')).closest('.subject-row')!;
    expect(within(set as HTMLElement).getByText(/6 \/ 10 learned · 2 due/)).toBeInTheDocument();
  });

  it('renders without the today strip when today is unavailable', async () => {
    todayMock.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByText('Flashcard accuracy')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument();
  });

  it('still shows the study overview when the flashcard statistics fail', async () => {
    getMock.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(
      await screen.findByText('Overall mastery', { selector: '.stat-label' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Flashcards and quizzes' }),
    ).not.toBeInTheDocument();
  });
});
