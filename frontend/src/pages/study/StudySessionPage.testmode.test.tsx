import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { studySessionService } from '../../services/studySessionService';
import { questionItem, result, session } from '../../test-fixtures/study';
import type { LearningSession } from '../../types';
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

function testSession(overrides: Partial<LearningSession> = {}): LearningSession {
  return session({
    type: 'test',
    mode: 'quick10',
    label: 'Biology Test',
    title: 'Practice test · Biology',
    hideFeedback: true,
    items: [questionItem('i1'), questionItem('i2'), questionItem('i3')],
    ...overrides,
  });
}

function saved(answered: number) {
  return {
    saved: answered,
    progress: { position: answered, total: 3, answered, skipped: 0, percent: Math.round((answered / 3) * 100) },
    session: { id: 's1', status: 'active' as const, currentPosition: answered, answeredCount: answered, durationSeconds: 20 },
  };
}

/** The fixed action bar of the runner (the "Review your answers" panel has its own Finish button). */
function actionBar(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('.session-cta-bar')!;
}

beforeEach(() => {
  vi.clearAllMocks();
  svc.get.mockResolvedValue(testSession());
  svc.saveAnswers.mockResolvedValue(saved(1));
});

describe('test session', () => {
  it('shows no explanation, no feedback and no mastery hint while the test runs', async () => {
    renderRunner();
    expect(await screen.findByRole('heading', { level: 2, name: 'Question i1?' })).toBeInTheDocument();

    expect(screen.getByText('No hints or explanations until you finish the test.')).toBeInTheDocument();
    expect(screen.getByText('Biology Test')).toBeInTheDocument();
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/correct answer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mastery/i)).not.toBeInTheDocument();
    // No tutor, no "explain this" while a test is running.
    expect(screen.queryByRole('button', { name: /ai tutor|explain this/i })).not.toBeInTheDocument();
    // There is no "Check answer": nothing is graded until the end.
    expect(screen.queryByRole('button', { name: /check answer/i })).not.toBeInTheDocument();
  });

  it('keeps answers in the page and saves them to the server in one batch when moving on', async () => {
    const user = userEvent.setup();
    const { container } = renderRunner();
    await user.click(await screen.findByRole('radio', { name: 'Option A' }));
    expect(screen.getByText('1 of 3 answered')).toBeInTheDocument();
    expect(svc.saveAnswers).not.toHaveBeenCalled();

    await user.click(within(actionBar(container)).getByRole('button', { name: /next question/i }));
    expect(svc.saveAnswers).toHaveBeenCalledTimes(1);
    expect(svc.saveAnswers).toHaveBeenCalledWith('s1', [{ itemId: 'i1', answer: 'Option A' }], 1);
    expect(await screen.findByRole('heading', { level: 2, name: 'Question i2?' })).toBeInTheDocument();
  });

  it('lets the student go back and change an answer', async () => {
    const user = userEvent.setup();
    const { container } = renderRunner();
    await user.click(await screen.findByRole('radio', { name: 'Option A' }));
    await user.click(within(actionBar(container)).getByRole('button', { name: /next question/i }));
    await user.click(within(actionBar(container)).getByRole('button', { name: 'Previous' }));

    expect(screen.getByRole('radio', { name: 'Option A' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Option C' }));
    expect(screen.getByRole('radio', { name: 'Option C' })).toBeChecked();
    expect(screen.getByText('1 of 3 answered')).toBeInTheDocument();
  });

  it('never drops an answer when saving fails: it stays on screen and is sent again', async () => {
    const user = userEvent.setup();
    svc.saveAnswers.mockRejectedValueOnce(new ApiError('Network error', 'network', 0));
    svc.saveAnswers.mockResolvedValueOnce(saved(1));
    const { container } = renderRunner();
    await user.click(await screen.findByRole('radio', { name: 'Option B' }));
    await user.click(within(actionBar(container)).getByRole('button', { name: /next question/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Network error');
    expect(alert).toHaveTextContent('Your answers are still here and will be saved again.');

    // Going back is enough: the unsaved answer travels with the next save.
    await user.click(within(actionBar(container)).getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('radio', { name: 'Option B' })).toBeChecked();
    await waitFor(() => expect(svc.saveAnswers).toHaveBeenCalledTimes(2));
    expect(svc.saveAnswers).toHaveBeenLastCalledWith('s1', [{ itemId: 'i1', answer: 'Option B' }], 0);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('offers "Save now" so the student can retry without moving', async () => {
    const user = userEvent.setup();
    svc.saveAnswers.mockRejectedValueOnce(new ApiError('Network error', 'network', 0));
    svc.saveAnswers.mockResolvedValueOnce(saved(1));
    const { container } = renderRunner();
    await user.click(await screen.findByRole('radio', { name: 'Option B' }));
    await user.click(within(actionBar(container)).getByRole('button', { name: /next question/i }));

    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Save now' }));
    await waitFor(() => expect(svc.saveAnswers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('resumes at the saved position with the saved answers', async () => {
    svc.get.mockResolvedValue(
      testSession({
        currentPosition: 1,
        items: [questionItem('i1', { answer: 'Option C' }), questionItem('i2', { answer: 'Option A' }), questionItem('i3')],
      }),
    );
    const { container } = renderRunner();
    expect(await screen.findByRole('heading', { level: 2, name: 'Question i2?' })).toBeInTheDocument();
    expect(screen.getByText('Question 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Option A' })).toBeChecked();
    expect(screen.getByText('2 of 3 answered')).toBeInTheDocument();
    await userEvent.setup().click(within(actionBar(container)).getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('radio', { name: 'Option C' })).toBeChecked();
  });

  it('jumps to any question from the overview, which also shows what is still open', async () => {
    const user = userEvent.setup();
    renderRunner();
    await user.click(await screen.findByRole('radio', { name: 'Option A' }));
    await user.click(screen.getByText('Review your answers'));

    const grid = screen.getByRole('list', { name: 'Questions' });
    expect(within(grid).getByRole('button', { name: 'Question 1, answered' })).toBeInTheDocument();
    expect(within(grid).getByRole('button', { name: 'Question 3, not answered yet' })).toBeInTheDocument();
    await user.click(within(grid).getByRole('button', { name: 'Question 3, not answered yet' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Question i3?' })).toBeInTheDocument();
  });
});

describe('handing in a test', () => {
  async function toLastQuestion(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
    await user.click(await screen.findByRole('radio', { name: 'Option A' }));
    await user.click(within(actionBar(container)).getByRole('button', { name: /next question/i }));
    await user.click(within(actionBar(container)).getByRole('button', { name: /next question/i }));
    await screen.findByRole('heading', { level: 2, name: 'Question i3?' });
  }

  it('asks for confirmation when questions are unanswered, then sends every answer with the request', async () => {
    const user = userEvent.setup();
    svc.complete.mockResolvedValue(
      testSession({
        status: 'completed',
        hideFeedback: false,
        answeredCount: 1,
        result: result({ total: 3, correct: 2, incorrect: 1, percent: 67 }),
      }),
    );
    const { container } = renderRunner();
    await toLastQuestion(user, container);

    await user.click(within(actionBar(container)).getByRole('button', { name: 'Finish test' }));
    const dialog = screen.getByRole('dialog', { name: 'Finish the test?' });
    expect(within(dialog).getByText('You have 2 unanswered questions. They count as incorrect.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Finish test' }));

    expect(svc.complete).toHaveBeenCalledWith('s1', [{ itemId: 'i1', answer: 'Option A' }]);
    expect(await screen.findByText('67%')).toBeInTheDocument();
  });

  it('lets the student keep working from the confirmation', async () => {
    const user = userEvent.setup();
    const { container } = renderRunner();
    await toLastQuestion(user, container);
    await user.click(within(actionBar(container)).getByRole('button', { name: 'Finish test' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep working' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(svc.complete).not.toHaveBeenCalled();
  });

  it('keeps the answers and offers a retry when handing in fails', async () => {
    const user = userEvent.setup();
    svc.get.mockResolvedValue(testSession({ items: [questionItem('i1')] }));
    svc.complete.mockRejectedValueOnce(new ApiError('The server is busy', 'busy', 503));
    svc.complete.mockResolvedValueOnce(
      testSession({ status: 'completed', hideFeedback: false, items: [questionItem('i1')], result: result({ total: 1, correct: 1, incorrect: 0, percent: 100, mistakeCount: 0 }) }),
    );
    const { container } = renderRunner();
    await user.click(await screen.findByRole('radio', { name: 'Option A' }));
    await user.click(within(actionBar(container)).getByRole('button', { name: 'Finish test' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The server is busy');
    expect(screen.getByRole('radio', { name: 'Option A' })).toBeChecked();
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(svc.complete).toHaveBeenCalledTimes(2);
  });
});

describe('test results', () => {
  const finished = (overrides = {}) =>
    testSession({
      status: 'completed',
      hideFeedback: false,
      answeredCount: 25,
      result: result({
        total: 25,
        answered: 25,
        correct: 18,
        incorrect: 7,
        partial: 0,
        percent: 72,
        mistakeCount: 7,
        knownWell: [
          { conceptId: 'c1', name: 'Osmosis', correct: 5, partial: 0, incorrect: 0, total: 5, percent: 100, masteryPercent: 80 },
        ],
        needsPractice: [
          { conceptId: 'c2', name: 'Diffusion', correct: 1, partial: 0, incorrect: 3, total: 4, percent: 25, masteryPercent: 20 },
        ],
        next: {
          type: 'practice',
          label: 'Practice Diffusion',
          description: 'You missed 3 questions on it.',
          conceptId: 'c2',
          conceptName: 'Diffusion',
        },
        testAttemptId: 'attempt-1',
        ...overrides,
      }),
    });

  it('shows the percentage, "18 / 25 correct", what is known well and what needs practice', async () => {
    svc.get.mockResolvedValue(finished());
    renderRunner();

    expect(await screen.findByText('72%')).toBeInTheDocument();
    expect(screen.getByText('18 / 25 correct')).toBeInTheDocument();
    const summary = screen.getByRole('group', { name: 'Test summary' });
    expect(within(summary).getByText('18')).toBeInTheDocument();
    expect(within(summary).getByText('7')).toBeInTheDocument();

    const known = screen.getByRole('heading', { name: 'You know well' }).closest('section')!;
    expect(within(known).getByText('Osmosis')).toBeInTheDocument();
    expect(within(known).getByText('5 / 5 · 100%')).toBeInTheDocument();
    const practice = screen.getByRole('heading', { name: 'Needs practice' }).closest('section')!;
    expect(within(practice).getByText('Diffusion')).toBeInTheDocument();
    expect(within(practice).getByText('1 / 4 · 25%')).toBeInTheDocument();
  });

  it('recommends the next step from the adaptive engine with a matching button', async () => {
    svc.get.mockResolvedValue(finished());
    renderRunner();

    const recommended = (await screen.findByRole('heading', { name: 'Recommended' })).closest('section')!;
    expect(within(recommended).getByText('Practice Diffusion')).toBeInTheDocument();
    expect(recommended).toHaveTextContent('You missed 3 questions on it.');
    expect(screen.getByRole('link', { name: 'Start practice' })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=practice&concept=c2',
    );
    expect(
      screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === '7 questions to review'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review mistakes (7)' })).toHaveAttribute('href', '/study/sessions/s1?view=mistakes');
  });

  it('offers another test when nothing is left to practise', async () => {
    svc.get.mockResolvedValue(
      finished({
        needsPractice: [],
        mistakeCount: 0,
        next: { type: 'test', label: 'Take an exam simulation', description: 'You are ready.', conceptId: null, conceptName: null },
      }),
    );
    renderRunner();
    expect(await screen.findByRole('link', { name: 'Take another test' })).toHaveAttribute('href', '/study-packs/pack-1?tab=test');
    expect(screen.getByText('Nothing needs extra practice. Well done.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /review mistakes/i })).not.toBeInTheDocument();
  });
});
