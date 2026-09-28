import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { progressService } from '../services/progressService';
import type { ProgressStats, TodaySummary, WeekSummary } from '../types';
import { ProgressPage } from './ProgressPage';

vi.mock('../services/progressService', () => ({
  progressService: { get: vi.fn(), today: vi.fn(), week: vi.fn() },
}));

const getMock = vi.mocked(progressService.get);
const todayMock = vi.mocked(progressService.today);
const weekMock = vi.mocked(progressService.week);

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
  render(
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
});

describe('ProgressPage', () => {
  it('labels flashcard accuracy explicitly and shows the today strip', async () => {
    renderPage();
    expect(await screen.findByText('Flashcard accuracy')).toBeInTheDocument();
    expect(await screen.findByText('Quiz accuracy')).toBeInTheDocument();
    expect(await screen.findByText(/80% card accuracy/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByLabelText('4 / 10 cards')).toBeInTheDocument();
  });

  it('renders without the today strip when today is unavailable', async () => {
    todayMock.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByText('Flashcard accuracy')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument();
  });
});
