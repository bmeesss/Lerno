import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { studyPackService } from '../../services/studyPackService';
import { studySessionService } from '../../services/studySessionService';
import { mistakes, questionItem, result, session } from '../../test-fixtures/study';
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
const tutorMock = vi.mocked(studyPackService.tutor);

function renderRunner(path = '/study/sessions/s1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/study/sessions/:sessionId" element={<StudySessionPage />} />
        <Route path="/study" element={<p>My Study page</p>} />
        <Route path="/study-packs/:packId" element={<p>Pack page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function feedback(overrides: Partial<ItemFeedback> = {}): ItemFeedback {
  return {
    verdict: 'incorrect',
    correctAnswer: 'Option A',
    explanation: 'Because water follows the solute.',
    masteryBeforePercent: 42,
    masteryAfterPercent: 35,
    source: { title: 'Biology.pdf', ref: 'page 3' },
    ...overrides,
  };
}

/** What the server returns after answering `item` (the session has `total` items). */
function answeredResponse(
  item: SessionItem,
  answer: string,
  fb: ItemFeedback,
  counts: { answered: number; total: number; position: number },
): SessionItemResponse {
  return {
    item: { ...item, status: 'answered', answer, feedback: fb },
    progress: {
      position: counts.position,
      total: counts.total,
      answered: counts.answered,
      skipped: 0,
      percent: Math.round((counts.answered / counts.total) * 100),
    },
    session: {
      id: 's1',
      status: 'active',
      currentPosition: counts.position,
      answeredCount: counts.answered,
      durationSeconds: 30,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  svc.get.mockResolvedValue(session());
});

describe('practice session', () => {
  it('shows one question at a time with its position and progress', async () => {
    renderRunner();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Question i1?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Biology Practice')).toBeInTheDocument();
    expect(screen.getByText('Question 1 of 3')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    // One activity per screen: only this question's options are on the page.
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.queryByText('Question i2?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check answer/i })).toBeDisabled();
  });

  it('moves focus to the question so keyboard and screen reader users start in the right place', async () => {
    renderRunner();
    const heading = await screen.findByRole('heading', { level: 2, name: 'Question i1?' });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('checks the answer, then shows instant feedback with explanation, concept, mastery and source', async () => {
    const user = userEvent.setup();
    const first = session().items[0]!;
    svc.answer.mockResolvedValue(
      answeredResponse(first, 'Option B', feedback(), { answered: 1, total: 3, position: 1 }),
    );
    renderRunner();

    await user.click(await screen.findByRole('radio', { name: 'Option B' }));
    await user.click(screen.getByRole('button', { name: /check answer/i }));

    expect(svc.answer).toHaveBeenCalledWith('s1', 'i1', 'Option B', expect.any(Number));
    const panel = await screen.findByRole('status');
    expect(panel).toHaveAttribute('aria-live', 'polite');
    expect(within(panel).getByText('Not quite')).toBeInTheDocument();
    expect(within(panel).getByText('Correct answer').parentElement).toHaveTextContent('Option A');
    expect(within(panel).getByText('Why').parentElement).toHaveTextContent(
      'Because water follows the solute.',
    );
    expect(within(panel).getByText('Concept').parentElement).toHaveTextContent('Osmosis');
    expect(within(panel).getByLabelText('Mastery 42% to 35%')).toBeInTheDocument();
    expect(within(panel).getByText('Source').parentElement).toHaveTextContent(
      'Biology.pdf · page 3',
    );
    // The answers can no longer be changed, and the next step has focus.
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    const next = screen.getByRole('button', { name: /next question/i });
    await waitFor(() => expect(next).toHaveFocus());
  });

  it('marks the right option without relying on colour alone', async () => {
    const user = userEvent.setup();
    const first = session().items[0]!;
    svc.answer.mockResolvedValue(
      answeredResponse(first, 'Option B', feedback(), { answered: 1, total: 3, position: 1 }),
    );
    renderRunner();
    await user.click(await screen.findByRole('radio', { name: 'Option B' }));
    await user.click(screen.getByRole('button', { name: /check answer/i }));

    const right = (await screen.findByRole('radio', { name: /Option A/ })).closest('label')!;
    expect(within(right).getByText('Correct answer')).toBeInTheDocument();
    const wrong = screen.getByRole('radio', { name: /Option B/ }).closest('label')!;
    expect(within(wrong).getByText('Your answer')).toBeInTheDocument();
  });

  it('continues to the next question after feedback', async () => {
    const user = userEvent.setup();
    const first = session().items[0]!;
    svc.answer.mockResolvedValue(
      answeredResponse(
        first,
        'Option A',
        feedback({ verdict: 'correct', masteryAfterPercent: 50 }),
        { answered: 1, total: 3, position: 1 },
      ),
    );
    renderRunner();
    await user.click(await screen.findByRole('radio', { name: 'Option A' }));
    await user.click(screen.getByRole('button', { name: /check answer/i }));
    expect(await screen.findByText('Well done')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /next question/i }));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Question i2?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Question 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
  });

  it('lets the student skip a question', async () => {
    const user = userEvent.setup();
    const first = session().items[0]!;
    svc.skip.mockResolvedValue({
      item: { ...first, status: 'skipped' },
      progress: { position: 1, total: 3, answered: 0, skipped: 1, percent: 33 },
      session: {
        id: 's1',
        status: 'active',
        currentPosition: 1,
        answeredCount: 0,
        durationSeconds: 5,
      },
    });
    renderRunner();
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(svc.skip).toHaveBeenCalledWith('s1', 'i1');
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Question i2?' }),
    ).toBeInTheDocument();
  });

  it('answers an open question from a text box', async () => {
    const user = userEvent.setup();
    const open = questionItem('i1', { options: null });
    open.question = { ...open.question!, questionType: 'short_answer', options: null };
    svc.get.mockResolvedValue(session({ items: [open] }));
    svc.answer.mockResolvedValue(
      answeredResponse(open, 'water moves', feedback({ verdict: 'partial' }), {
        answered: 1,
        total: 1,
        position: 1,
      }),
    );
    renderRunner();

    const box = await screen.findByLabelText('Your answer');
    await user.type(box, 'water moves');
    await user.click(screen.getByRole('button', { name: /check answer/i }));
    expect(svc.answer).toHaveBeenCalledWith('s1', 'i1', 'water moves', expect.any(Number));
    expect(await screen.findByText('Almost there')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /see results/i })).toBeInTheDocument();
  });
});

describe('finishing a practice session', () => {
  async function finishOneQuestion(mistakeCount = 1) {
    const user = userEvent.setup();
    const only = questionItem('i1');
    svc.get.mockResolvedValue(session({ items: [only] }));
    svc.answer.mockResolvedValue(
      answeredResponse(only, 'Option B', feedback(), { answered: 1, total: 1, position: 1 }),
    );
    const completed: LearningSession = session({
      items: [{ ...only, status: 'answered', answer: 'Option B', feedback: feedback() }],
      status: 'completed',
      answeredCount: 1,
      completedAt: '2026-09-29T09:30:00.000Z',
      result: result({ mistakeCount }),
    });
    svc.complete.mockResolvedValue(completed);
    renderRunner();
    await user.click(await screen.findByRole('radio', { name: 'Option B' }));
    await user.click(screen.getByRole('button', { name: /check answer/i }));
    await user.click(await screen.findByRole('button', { name: /see results/i }));
    return user;
  }

  it('ends with the improvement, what is still weak and the next step', async () => {
    await finishOneQuestion();

    expect(
      await screen.findByRole('heading', { name: 'Great work — Osmosis improved from 42% → 61%' }),
    ).toBeInTheDocument();
    expect(svc.complete).toHaveBeenCalledWith('s1');
    expect(screen.getByText('2 concepts still need attention')).toBeInTheDocument();
    expect(screen.getByText('Diffusion')).toBeInTheDocument();
    expect(screen.getByText('18% mastery')).toBeInTheDocument();
    const summary = screen.getByRole('group', { name: 'Session summary' });
    expect(within(summary).getByText('7 min')).toBeInTheDocument();
    expect(within(summary).getByText('correct')).toBeInTheDocument();
    expect(within(summary).getByText('incorrect')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Next: Practice Diffusion/ })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=practice&concept=c2',
    );
    expect(screen.getByText('You missed 1 question on it.')).toBeInTheDocument();
  });

  it('offers "Review mistakes" from the result, and only when there are mistakes', async () => {
    await finishOneQuestion(1);
    expect(await screen.findByRole('link', { name: 'Review mistakes (1)' })).toHaveAttribute(
      'href',
      '/study/sessions/s1?view=mistakes',
    );
  });

  it('hides "Review mistakes" after a perfect session', async () => {
    await finishOneQuestion(0);
    await screen.findByRole('heading', { name: /Great work/ });
    expect(screen.queryByRole('link', { name: /Review mistakes/ })).not.toBeInTheDocument();
  });

  it('shows a retry and keeps the progress when finishing fails', async () => {
    const user = userEvent.setup();
    const only = questionItem('i1');
    svc.get.mockResolvedValue(session({ items: [only] }));
    svc.answer.mockResolvedValue(
      answeredResponse(only, 'Option A', feedback({ verdict: 'correct' }), {
        answered: 1,
        total: 1,
        position: 1,
      }),
    );
    svc.complete.mockRejectedValueOnce(new ApiError('The server is busy', 'busy', 503));
    svc.complete.mockResolvedValueOnce(
      session({
        items: [only],
        status: 'completed',
        answeredCount: 1,
        result: result({ mistakeCount: 0 }),
      }),
    );
    renderRunner();
    await user.click(await screen.findByRole('radio', { name: 'Option A' }));
    await user.click(screen.getByRole('button', { name: /check answer/i }));
    await user.click(await screen.findByRole('button', { name: /see results/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The server is busy');
    expect(screen.getByText('Well done')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /see results/i }));
    expect(await screen.findByRole('heading', { name: /Great work/ })).toBeInTheDocument();
  });

  it('ends quietly when everything was skipped, because there is nothing to report', async () => {
    const user = userEvent.setup();
    const only = questionItem('i1');
    svc.get.mockResolvedValue(session({ items: [only] }));
    svc.skip.mockResolvedValue({
      item: { ...only, status: 'skipped' },
      progress: { position: 1, total: 1, answered: 0, skipped: 1, percent: 100 },
      session: {
        id: 's1',
        status: 'active',
        currentPosition: 1,
        answeredCount: 0,
        durationSeconds: 3,
      },
    });
    svc.abandon.mockResolvedValue(session({ status: 'abandoned' }));
    renderRunner();
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(await screen.findByText('Pack page')).toBeInTheDocument();
    expect(svc.abandon).toHaveBeenCalledWith('s1');
    expect(svc.complete).not.toHaveBeenCalled();
  });
});

describe('resume, errors and leaving', () => {
  it('resumes at the first open question: "Question 6 of 10"', async () => {
    const items = Array.from({ length: 10 }, (_, index) => {
      const item = questionItem(`i${index + 1}`);
      return index < 5
        ? { ...item, status: 'answered' as const, answer: 'Option A', feedback: feedback() }
        : item;
    });
    svc.get.mockResolvedValue(
      session({
        items,
        answeredCount: 5,
        currentPosition: 5,
        progress: { position: 5, total: 10, answered: 5, skipped: 0, percent: 50 },
      }),
    );
    renderRunner();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Question i6?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Question 6 of 10')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('keeps the selected answer and offers a retry when checking fails', async () => {
    const user = userEvent.setup();
    const first = session().items[0]!;
    svc.answer.mockRejectedValueOnce(new ApiError('Connection lost', 'network', 0));
    svc.answer.mockResolvedValueOnce(
      answeredResponse(first, 'Option B', feedback(), { answered: 1, total: 3, position: 1 }),
    );
    renderRunner();
    await user.click(await screen.findByRole('radio', { name: 'Option B' }));
    await user.click(screen.getByRole('button', { name: /check answer/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Connection lost');
    expect(screen.getByRole('radio', { name: 'Option B' })).toBeChecked();
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Not quite')).toBeInTheDocument();
    expect(svc.answer).toHaveBeenCalledTimes(2);
  });

  it('says when a session cannot be opened and lets the student retry', async () => {
    svc.get.mockRejectedValueOnce(new ApiError('Study session not found', 'not_found', 404));
    const user = userEvent.setup();
    renderRunner();

    expect(
      await screen.findByRole('heading', { name: 'Could not open this session' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Study session not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to My Study' })).toHaveAttribute(
      'href',
      '/study',
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Question i1?' }),
    ).toBeInTheDocument();
  });

  it('explains that an ended session was kept, and offers a fresh start', async () => {
    svc.get.mockResolvedValue(session({ status: 'abandoned' }));
    renderRunner();
    expect(
      await screen.findByRole('heading', { name: 'This session was ended' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start again' })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=practice',
    );
  });

  it('asks before leaving, reassures that progress is saved and can end with results', async () => {
    const user = userEvent.setup();
    const first = session().items[0]!;
    svc.get.mockResolvedValue(
      session({
        answeredCount: 1,
        items: [
          { ...first, status: 'answered', answer: 'Option A', feedback: feedback() },
          questionItem('i2'),
        ],
      }),
    );
    svc.complete.mockResolvedValue(
      session({ status: 'completed', answeredCount: 1, result: result() }),
    );
    renderRunner();
    await user.click(await screen.findByRole('button', { name: 'Leave' }));

    const dialog = screen.getByRole('dialog', { name: 'Leave this session?' });
    expect(within(dialog).getByText(/progress is saved on your account/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'End and see results' }));
    expect(await screen.findByRole('heading', { name: /Great work/ })).toBeInTheDocument();
  });

  it('leaves for now without losing the session', async () => {
    const user = userEvent.setup();
    renderRunner();
    await user.click(await screen.findByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Leave for now' }));
    expect(await screen.findByText('My Study page')).toBeInTheDocument();
    expect(svc.abandon).not.toHaveBeenCalled();
  });

  it('closes the leave dialog with Escape and returns to the question', async () => {
    const user = userEvent.setup();
    renderRunner();
    await user.click(await screen.findByRole('button', { name: 'Leave' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Question i1?' })).toBeInTheDocument();
  });
});

describe('contextual help', () => {
  async function answerFirst(isOwner: boolean) {
    const user = userEvent.setup();
    const first = session().items[0]!;
    svc.get.mockResolvedValue(session({ isOwner }));
    svc.answer.mockResolvedValue(
      answeredResponse(first, 'Option B', feedback(), { answered: 1, total: 3, position: 1 }),
    );
    renderRunner();
    await user.click(await screen.findByRole('radio', { name: 'Option B' }));
    await user.click(screen.getByRole('button', { name: /check answer/i }));
    await screen.findByText('Not quite');
    return user;
  }

  it('offers Ask AI Tutor, Explain this, Show source and Practice this next to the feedback', async () => {
    await answerFirst(true);
    const help = screen.getByRole('group', { name: 'Help with this concept' });
    expect(within(help).getByRole('button', { name: 'Ask AI Tutor' })).toBeInTheDocument();
    expect(within(help).getByRole('button', { name: 'Explain this' })).toBeInTheDocument();
    expect(within(help).getByRole('button', { name: 'Show source' })).toBeInTheDocument();
    expect(within(help).getByRole('link', { name: 'Practice this' })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=practice&concept=c1',
    );
  });

  it('opens the tutor with the concept, session and question as context', async () => {
    tutorMock.mockResolvedValue({
      reply: 'Water follows the solute.',
      basedOnMaterial: true,
      citations: [],
    });
    const user = await answerFirst(true);
    await user.click(screen.getByRole('button', { name: 'Explain this' }));

    const dialog = await screen.findByRole('dialog', { name: 'AI Tutor · Osmosis' });
    await waitFor(() =>
      expect(tutorMock).toHaveBeenCalledWith('pack-1', 'Explain Osmosis in simple words.', [], {
        conceptId: 'c1',
        sessionId: 's1',
        itemId: 'i1',
      }),
    );
    expect(await within(dialog).findByText('Based on your material')).toBeInTheDocument();
  });

  it('shows the passage a concept comes from', async () => {
    svc.conceptSource.mockResolvedValue({
      concept: { id: 'c1', name: 'Osmosis' },
      source: { id: 'source-1', title: 'Biology.pdf', kind: 'pdf' },
      excerpt: {
        text: 'Osmosis is the diffusion of water across a membrane.',
        ref: 'page 3',
        match: 'reference',
      },
    });
    const user = await answerFirst(true);
    await user.click(screen.getByRole('button', { name: 'Show source' }));

    expect(svc.conceptSource).toHaveBeenCalledWith('pack-1', 'c1');
    const region = await screen.findByRole('region', { name: 'Source' });
    expect(within(region).getByText('Biology.pdf · page 3')).toBeInTheDocument();
    expect(
      within(region).getByText('Osmosis is the diffusion of water across a membrane.'),
    ).toBeInTheDocument();
  });

  it('says so when a concept has no source, instead of inventing one', async () => {
    svc.conceptSource.mockResolvedValue({
      concept: { id: 'c1', name: 'Osmosis' },
      source: null,
      excerpt: null,
    });
    const user = await answerFirst(true);
    await user.click(screen.getByRole('button', { name: 'Show source' }));
    expect(await screen.findByText('No source is linked to this concept yet.')).toBeInTheDocument();
  });

  it('hides the tutor on a pack the student does not own, but keeps the source', async () => {
    await answerFirst(false);
    const help = screen.getByRole('group', { name: 'Help with this concept' });
    expect(within(help).queryByRole('button', { name: 'Ask AI Tutor' })).not.toBeInTheDocument();
    expect(within(help).queryByRole('button', { name: 'Explain this' })).not.toBeInTheDocument();
    expect(within(help).getByRole('button', { name: 'Show source' })).toBeInTheDocument();
  });
});

describe('review mistakes', () => {
  beforeEach(() => {
    svc.get.mockResolvedValue(
      session({
        status: 'completed',
        answeredCount: 3,
        result: result(),
        items: session().items.map((item) => ({ ...item, status: 'answered' as const })),
      }),
    );
    svc.mistakes.mockResolvedValue(mistakes());
  });

  it('lists only what went wrong, with your answer, the right one, the explanation, the concept and the source', async () => {
    renderRunner('/study/sessions/s1?view=mistakes');

    expect(await screen.findByRole('heading', { name: 'Review mistakes' })).toBeInTheDocument();
    expect(screen.getByText(/1 question to learn from/)).toBeInTheDocument();
    const card = screen
      .getByRole('heading', { name: 'Which way does water move in osmosis?' })
      .closest('li')!;
    expect(within(card).getByText('Your answer').nextElementSibling).toHaveTextContent(
      'Towards less solute',
    );
    expect(within(card).getByText('Correct answer').nextElementSibling).toHaveTextContent(
      'Towards more solute',
    );
    expect(within(card).getByText('Explanation').nextElementSibling).toHaveTextContent(
      'Water follows the solute across the membrane.',
    );
    expect(within(card).getByText('Concept').nextElementSibling).toHaveTextContent('Osmosis');
    expect(within(card).getByText('Source').nextElementSibling).toHaveTextContent(
      'Biology.pdf · page 3',
    );
    expect(
      screen.getAllByRole('listitem').filter((item) => item.classList.contains('mistake-card')),
    ).toHaveLength(1);
  });

  it('turns every mistake into practice for that concept', async () => {
    renderRunner('/study/sessions/s1?view=mistakes');
    expect(await screen.findByRole('link', { name: 'Practice this concept' })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=practice&concept=c1',
    );
    expect(screen.getByRole('button', { name: 'Ask AI Tutor' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to results' })).toHaveAttribute(
      'href',
      '/study/sessions/s1',
    );
  });

  it('congratulates instead of showing an empty list when nothing was wrong', async () => {
    svc.mistakes.mockResolvedValue(mistakes({ total: 0, mistakes: [] }));
    renderRunner('/study/sessions/s1?view=mistakes');
    expect(
      await screen.findByRole('heading', { name: 'No mistakes to review' }),
    ).toBeInTheDocument();
  });

  it('retries when the mistakes cannot be loaded', async () => {
    svc.mistakes.mockRejectedValueOnce(new Error('Offline'));
    const user = userEvent.setup();
    renderRunner('/study/sessions/s1?view=mistakes');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Offline');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Review mistakes' })).toBeInTheDocument();
  });
});
