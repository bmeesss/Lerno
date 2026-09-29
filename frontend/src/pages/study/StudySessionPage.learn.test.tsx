import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { studySessionService } from '../../services/studySessionService';
import { conceptItem, result, session } from '../../test-fixtures/study';
import type { ItemFeedback, LearningSession, SessionItem, SessionItemResponse } from '../../types';
import { StudySessionPage } from './StudySessionPage';

vi.mock('../../services/studySessionService', () => ({
  studySessionService: {
    get: vi.fn(),
    answer: vi.fn(),
    rate: vi.fn(),
    skip: vi.fn(),
    saveAnswers: vi.fn(),
    complete: vi.fn(),
    abandon: vi.fn(),
    mistakes: vi.fn(),
    conceptSource: vi.fn(),
  },
}));
vi.mock('../../services/studyPackService', () => ({ studyPackService: { tutor: vi.fn() } }));

const svc = vi.mocked(studySessionService);

function renderRunner() {
  return render(
    <MemoryRouter initialEntries={['/study/sessions/s1']}>
      <Routes>
        <Route path="/study/sessions/:sessionId" element={<StudySessionPage />} />
        <Route path="/study" element={<p>My Study page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function learnSession(items: SessionItem[], overrides: Partial<LearningSession> = {}): LearningSession {
  return session({ type: 'learn', label: 'Biology Learn', title: 'Learn Biology', items, ...overrides });
}

const FEEDBACK: ItemFeedback = {
  verdict: 'correct',
  correctAnswer: 'The right answer',
  explanation: 'It is the right answer.',
  masteryBeforePercent: 20,
  masteryAfterPercent: 35,
  source: null,
};

function response(item: SessionItem, patch: Partial<SessionItem>, answered: number, total: number): SessionItemResponse {
  return {
    item: { ...item, ...patch },
    progress: { position: answered, total, answered, skipped: 0, percent: Math.round((answered / total) * 100) },
    session: { id: 's1', status: 'active', currentPosition: answered, answeredCount: answered, durationSeconds: 60 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('learn session', () => {
  it('teaches a concept in three short screens: explanation and example, a check, a self-rating', async () => {
    const user = userEvent.setup();
    const first = conceptItem('i1', 'Osmosis');
    const second = conceptItem('i2', 'Diffusion');
    svc.get.mockResolvedValue(learnSession([first, second]));
    svc.answer.mockResolvedValue(response(first, { answer: 'The right answer', feedback: FEEDBACK }, 0, 2));
    svc.rate.mockResolvedValue(response(first, { status: 'answered', rating: 'good', answer: 'The right answer', feedback: FEEDBACK }, 1, 2));
    renderRunner();

    // 1. What is it? + Example
    expect(await screen.findByRole('heading', { level: 2, name: 'Osmosis' })).toBeInTheDocument();
    expect(screen.getByText('Concept 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What is it?' })).toBeInTheDocument();
    expect(screen.getByText('Osmosis is explained in plain words.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Example' })).toBeInTheDocument();
    expect(screen.getByText('An example of Osmosis from your notes.')).toBeInTheDocument();
    expect(screen.getByText('From Biology.pdf')).toBeInTheDocument();
    expect(screen.getByText('Needs another pass')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /check yourself/i }));

    // 2. Check yourself
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Check yourself' })).toBeInTheDocument();
    expect(screen.getByText('What does Osmosis describe?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check answer/i })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'The right answer' }));
    await user.click(screen.getByRole('button', { name: /check answer/i }));
    expect(svc.answer).toHaveBeenCalledWith('s1', 'i1', 'The right answer', expect.any(Number));
    expect(await screen.findByText('Well done')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^continue/i }));

    // 3. How well do you know this?
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'How well do you know this?' });
    const labels = within(group).getAllByRole('button').map((button) => within(button).getByText(/^(Again|Hard|Good|Easy)$/).textContent);
    expect(labels).toEqual(['Again', 'Hard', 'Good', 'Easy']);
    await user.click(within(group).getByRole('button', { name: /good/i }));

    expect(svc.rate).toHaveBeenCalledWith('s1', 'i1', 'good', expect.any(Number));
    // …and on to the next concept.
    expect(await screen.findByRole('heading', { level: 2, name: 'Diffusion' })).toBeInTheDocument();
    expect(screen.getByText('Concept 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
  });

  it('says so instead of inventing an example when the material has none', async () => {
    const plain = conceptItem('i1', 'Osmosis');
    plain.learn = { ...plain.learn!, example: null };
    svc.get.mockResolvedValue(learnSession([plain]));
    renderRunner();
    expect(await screen.findByText('There is no example for this concept in your material yet.')).toBeInTheDocument();
  });

  it('goes straight to the rating when a concept has no check question', async () => {
    const user = userEvent.setup();
    const bare = conceptItem('i1', 'Osmosis', { question: null });
    svc.get.mockResolvedValue(learnSession([bare]));
    renderRunner();
    await user.click(await screen.findByRole('button', { name: /how well do you know this\?/i }));
    expect(screen.getByRole('group', { name: 'How well do you know this?' })).toBeInTheDocument();
  });

  it('lets the student skip the check and rate anyway', async () => {
    const user = userEvent.setup();
    svc.get.mockResolvedValue(learnSession([conceptItem('i1', 'Osmosis')]));
    renderRunner();
    await user.click(await screen.findByRole('button', { name: /check yourself/i }));
    await user.click(screen.getByRole('button', { name: /skip the check/i }));
    expect(screen.getByRole('button', { name: /easy/i })).toBeInTheDocument();
    expect(svc.answer).not.toHaveBeenCalled();
  });

  it('continues at the rating after a reload, because the check was already answered', async () => {
    const checked = conceptItem('i1', 'Osmosis', { answer: 'The right answer', feedback: FEEDBACK });
    svc.get.mockResolvedValue(learnSession([checked]));
    renderRunner();
    expect(await screen.findByRole('group', { name: 'How well do you know this?' })).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
  });

  it('keeps the rating buttons and shows a retry when saving the rating fails', async () => {
    const user = userEvent.setup();
    const checked = conceptItem('i1', 'Osmosis', { answer: 'The right answer', feedback: FEEDBACK });
    svc.get.mockResolvedValue(learnSession([checked]));
    svc.rate.mockRejectedValueOnce(new ApiError('Connection lost', 'network', 0));
    renderRunner();
    await user.click(await screen.findByRole('button', { name: /hard/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Connection lost');
    // The student can simply choose again: the ratings are still there.
    expect(screen.getByRole('button', { name: /hard/i })).toBeEnabled();
  });

  it('ends with a summary of what improved and what comes next', async () => {
    const user = userEvent.setup();
    const checked = conceptItem('i1', 'Osmosis', { answer: 'The right answer', feedback: FEEDBACK });
    svc.get.mockResolvedValue(learnSession([checked]));
    svc.rate.mockResolvedValue(response(checked, { status: 'answered', rating: 'easy' }, 1, 1));
    svc.complete.mockResolvedValue(
      learnSession([{ ...checked, status: 'answered', rating: 'easy' }], {
        status: 'completed',
        answeredCount: 1,
        result: result({ answered: 1, correct: 1, incorrect: 0, mistakeCount: 0, stillWeak: [{ conceptId: 'c2', name: 'Diffusion', masteryPercent: 18 }] }),
      }),
    );
    renderRunner();
    await user.click(await screen.findByRole('button', { name: /easy/i }));

    expect(await screen.findByRole('heading', { name: 'Great work — Osmosis improved from 42% → 61%' })).toBeInTheDocument();
    expect(screen.getByText('1 concept still needs attention')).toBeInTheDocument();
    expect(screen.getByText('concept rated')).toBeInTheDocument();
    // Learn sessions have no right or wrong, so there is nothing to "review".
    expect(screen.queryByRole('link', { name: /review mistakes/i })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('link', { name: /Next: Practice Diffusion/ })).toBeInTheDocument());
  });
});
