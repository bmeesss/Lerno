import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { quizService } from '../../services/quizService';
import type { Quiz, QuizAttemptResult } from '../../types';
import { QuizPage } from './QuizPage';

vi.mock('../../services/quizService', () => ({
  quizService: { load: vi.fn(), submit: vi.fn() },
}));

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: { user: null as unknown },
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: mockAuth.user }),
}));

const loadMock = vi.mocked(quizService.load);
const submitMock = vi.mocked(quizService.submit);

const QUIZ: Quiz = {
  id: 'quiz-1',
  setId: 'set-1',
  title: 'Capitals quiz',
  questions: [
    {
      id: 'q1',
      prompt: 'Capital of France?',
      questionType: 'multiple_choice',
      options: ['Paris', 'Berlin', 'Madrid'],
      position: 0,
    },
    {
      id: 'q2',
      prompt: 'Capital of Germany? — "Madrid"',
      questionType: 'true_false',
      options: ['True', 'False'],
      position: 1,
    },
    {
      id: 'q3',
      prompt: 'Capital of Spain?',
      questionType: 'short_answer',
      options: null,
      position: 2,
    },
  ],
};

const RESULT: QuizAttemptResult = {
  quizId: 'quiz-1',
  score: 2,
  total: 3,
  accuracy: 2 / 3,
  correct: 2,
  incorrect: 1,
  questions: [
    {
      questionId: 'q1',
      prompt: 'Capital of France?',
      questionType: 'multiple_choice',
      yourAnswer: 'Paris',
      correctAnswer: 'Paris',
      correct: true,
      options: ['Paris', 'Berlin', 'Madrid'],
    },
    {
      questionId: 'q2',
      prompt: 'Capital of Germany? — "Madrid"',
      questionType: 'true_false',
      yourAnswer: 'True',
      correctAnswer: 'False',
      correct: false,
      options: ['True', 'False'],
    },
    {
      questionId: 'q3',
      prompt: 'Capital of Spain?',
      questionType: 'short_answer',
      yourAnswer: 'madrid',
      correctAnswer: 'Madrid',
      correct: true,
      options: null,
    },
  ],
  topicsNeedingPractice: ['Capital of Germany?'],
  persisted: true,
};

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/sets/set-1/quiz']}>
      <Routes>
        <Route path="/sets/:setId/quiz" element={<QuizPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { id: 'u1', displayName: 'Student' };
  loadMock.mockResolvedValue(QUIZ);
  submitMock.mockResolvedValue(RESULT);
});

describe('QuizPage', () => {
  it('shows a start screen with the question mix before starting', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /start quiz/i })).toBeInTheDocument();
    expect(screen.getByText('Capitals quiz')).toBeInTheDocument();
    expect(screen.getByText(/1 multiple choice · 1 true \/ false · 1 short answer/)).toBeInTheDocument();
    // No question is shown yet.
    expect(screen.queryByText('Capital of France?')).not.toBeInTheDocument();
  });

  it('walks through questions, submits answers, and shows the result', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /start quiz/i }));

    // Question 1: multiple choice.
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /paris/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    // Question 2: true/false.
    expect(screen.getByText('Capital of Germany? — "Madrid"')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /true/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    // Question 3: short answer.
    await user.type(screen.getByPlaceholderText(/type your answer/i), 'madrid');
    expect(screen.queryByText(/unanswered/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /finish quiz/i }));

    expect(submitMock).toHaveBeenCalledWith('set-1', [
      { questionId: 'q1', answer: 'Paris' },
      { questionId: 'q2', answer: 'True' },
      { questionId: 'q3', answer: 'madrid' },
    ]);

    // Result page.
    expect(await screen.findByText('67%')).toBeInTheDocument();
    expect(screen.getByText(/finished in/i)).toBeInTheDocument();
    const values = screen.getAllByText(/[0123]/, { selector: '.stat-value' });
    expect(values.map((el) => el.textContent)).toEqual(['2', '1', '3']);
    // Review: wrong answer shows the correction.
    expect(screen.getByText('Capital of Germany? — "Madrid"')).toBeInTheDocument();
    expect(screen.getByText(/correct answer:/i)).toBeInTheDocument();
    // The missed topic appears both in the review and in topicsNeedingPractice.
    expect(screen.getAllByText(/capital of germany/i)).toHaveLength(2);
    // Next actions.
    expect(screen.getByRole('button', { name: /restart quiz/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /continue practice/i })).toHaveAttribute(
      'href',
      '/sets/set-1/practice',
    );
  });

  it('warns about unanswered questions on the last step and restarts cleanly', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /start quiz/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    expect(screen.getByText(/3 questions unanswered/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /finish quiz/i }));
    expect(await screen.findByText('67%')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /restart quiz/i }));
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('0 answered')).toBeInTheDocument();
  });

  it('shows an insufficient-set state when the set has no cards', async () => {
    loadMock.mockRejectedValueOnce(
      new ApiError('This set needs at least one card before a quiz can be made', 'VALIDATION_ERROR', 400),
    );
    renderPage();
    expect(await screen.findByText('No quiz yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add cards/i })).toHaveAttribute('href', '/sets/set-1');
  });

  it('shows a generic error when the quiz cannot be loaded', async () => {
    loadMock.mockRejectedValueOnce(new ApiError('Study set not found', 'NOT_FOUND', 404));
    renderPage();
    expect(await screen.findByText('Could not load quiz')).toBeInTheDocument();
  });

  it('shows the guest banner for unsaved guest results', async () => {
    mockAuth.user = null;
    submitMock.mockResolvedValue({ ...RESULT, persisted: false });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /start quiz/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /finish quiz/i }));

    expect(await screen.findByText(/taken as a guest/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create free account/i })).toHaveAttribute(
      'href',
      '/signup',
    );
  });

  it('recovers to the quiz when submitting fails', async () => {
    submitMock.mockRejectedValueOnce(new Error('network down'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /start quiz/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /finish quiz/i }));

    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    // Still on the last question, able to retry.
    expect(screen.getByRole('button', { name: /finish quiz/i })).toBeInTheDocument();
  });
});
