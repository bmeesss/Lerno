import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/Toast';
import { guestProgress } from '../../services/guestProgress';
import { studyService, type PracticeQueue } from '../../services/studyService';
import { PracticePage } from './PracticePage';

vi.mock('../../services/studyService', () => ({
  studyService: {
    review: vi.fn(),
    practiceQueue: vi.fn(),
    startSession: vi.fn(),
    endSession: vi.fn(),
  },
}));

vi.mock('../../services/guestProgress', () => ({
  guestProgress: { record: vi.fn() },
}));

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: { user: null as unknown },
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: mockAuth.user }),
}));

const reviewMock = vi.mocked(studyService.review);
const queueMock = vi.mocked(studyService.practiceQueue);
const startSessionMock = vi.mocked(studyService.startSession);
const endSessionMock = vi.mocked(studyService.endSession);
const guestRecordMock = vi.mocked(guestProgress.record);

const QUEUE: PracticeQueue = {
  setId: 'set-1',
  title: 'Biology',
  cards: [
    {
      card: { id: 'card-1', question: 'What is a cell?', answer: 'Basic unit of life', position: 0 },
      reason: 'new',
    },
    {
      card: { id: 'card-2', question: 'What is DNA?', answer: 'Genetic material', position: 1 },
      reason: 'new',
    },
  ],
};

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/sets/set-1/practice']}>
      <ToastProvider>
        <Routes>
          <Route path="/sets/:setId/practice" element={<PracticePage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { id: 'u1', displayName: 'Student' };
  queueMock.mockResolvedValue(QUEUE);
  reviewMock.mockResolvedValue({ progress: {}, requeued: false } as never);
  startSessionMock.mockResolvedValue({ id: 'session-1' } as never);
  endSessionMock.mockResolvedValue({ id: 'session-1' } as never);
});

async function answer(user: ReturnType<typeof userEvent.setup>, result: 'Correct' | 'Incorrect') {
  await user.click(screen.getByRole('button', { name: /show answer/i }));
  await user.click(screen.getByRole('button', { name: new RegExp(`^${result}$`, 'i') }));
}

describe('PracticePage', () => {
  it('shows a result screen with percentage after completing the queue', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('What is a cell?')).toBeInTheDocument();

    await answer(user, 'Correct');
    await answer(user, 'Correct');

    expect(await screen.findByText('Practice complete ⚡')).toBeInTheDocument();
    expect(screen.getByText('100% flashcard accuracy')).toBeInTheDocument();
    expect(screen.getByText(/2 answers — 2 correct, 0 incorrect/)).toBeInTheDocument();
    // No mistakes: no retry button, but a useful next action.
    expect(screen.queryByRole('button', { name: /practice mistakes/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /take a quiz/i })).toBeInTheDocument();
    expect(endSessionMock).toHaveBeenCalledWith('session-1', 2);
  });

  it('lets the student retry only the mistaken cards', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('What is a cell?')).toBeInTheDocument();

    // First card wrong (requeued to the end), second right, first right.
    await answer(user, 'Incorrect');
    expect(await screen.findByText('What is DNA?')).toBeInTheDocument();
    await answer(user, 'Correct');
    expect(await screen.findByText('What is a cell?')).toBeInTheDocument();
    await answer(user, 'Correct');

    expect(await screen.findByText('Practice complete ⚡')).toBeInTheDocument();
    expect(screen.getByText('67% flashcard accuracy')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /practice mistakes again \(1\)/i });
    await user.click(retry);

    expect(await screen.findByText(/retry round/i)).toBeInTheDocument();
    expect(screen.getByText('What is a cell?')).toBeInTheDocument();
    expect(screen.queryByText('What is DNA?')).not.toBeInTheDocument();
    expect(reviewMock).toHaveBeenCalledWith('set-1', 'card-1', 'incorrect');
  });

  it('records guest answers on-device and shows the guest banner', async () => {
    mockAuth.user = null;
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('What is a cell?')).toBeInTheDocument();
    expect(screen.getByText(/guest practice/i)).toBeInTheDocument();

    await answer(user, 'Correct');
    await answer(user, 'Correct');

    expect(await screen.findByText('Practice complete ⚡')).toBeInTheDocument();
    expect(guestRecordMock).toHaveBeenCalledTimes(2);
    expect(reviewMock).not.toHaveBeenCalled();
    expect(startSessionMock).not.toHaveBeenCalled();
  });

  it('shows an empty state when the set has no cards', async () => {
    queueMock.mockResolvedValue({ ...QUEUE, cards: [] });
    renderPage();
    expect(await screen.findByText('Nothing to practice')).toBeInTheDocument();
    expect(
      within(screen.getByText('Nothing to practice').closest('div')!).getByRole('link', {
        name: /back to set/i,
      }),
    ).toBeInTheDocument();
  });
});
