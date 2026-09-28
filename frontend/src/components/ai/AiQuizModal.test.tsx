import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { aiLearningService } from '../../services/aiLearningService';
import { AiQuizModal } from './AiQuizModal';

vi.mock('../../services/aiLearningService', () => ({
  aiLearningService: {
    explainSet: vi.fn(),
    summarizeSet: vi.fn(),
    generateQuestions: vi.fn(),
    generateQuiz: vi.fn(),
    generateSet: vi.fn(),
    cardAction: vi.fn(),
    evaluateAnswer: vi.fn(),
    hint: vi.fn(),
    finishStudy: vi.fn(),
  },
}));

const quizMock = vi.mocked(aiLearningService.generateQuiz);
const evaluateMock = vi.mocked(aiLearningService.evaluateAnswer);

const quiz = {
  questions: [
    {
      type: 'multiple_choice' as const,
      question: 'Wanneer begon de Franse Revolutie?',
      options: ['1688', '1789', '1848', '1917'],
      correctIndex: 1,
      answer: '1789',
      explanation: 'De Bastille werd in 1789 bestormd.',
    },
    {
      type: 'true_false' as const,
      question: 'Robespierre was een leider van de Terreur.',
      options: ['True', 'False'],
      correctIndex: 0,
      answer: 'True',
      explanation: 'Hij zat in het Comité de Salut Public.',
    },
    {
      type: 'open' as const,
      question: 'Welke gevangenis werd bestormd?',
      options: [],
      correctIndex: null,
      answer: 'De Bastille',
      explanation: 'Op 14 juli 1789.',
    },
  ],
  meta: { setId: 'set-1', totalCards: 12, contextCards: 12, omittedCards: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  quizMock.mockResolvedValue(quiz);
});

describe('AiQuizModal', () => {
  it('generates a quiz on open and renders multiple choice options', async () => {
    render(<AiQuizModal open setId="set-1" onClose={() => undefined} />);

    expect(quizMock).toHaveBeenCalledWith('set-1', 10, ['multiple_choice'], 'normal');
    expect(await screen.findByText('Wanneer begon de Franse Revolutie?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1789' })).toBeInTheDocument();
  });

  it('scores a multiple choice answer and shows the explanation', async () => {
    render(<AiQuizModal open setId="set-1" onClose={() => undefined} />);
    await screen.findByText('Wanneer begon de Franse Revolutie?');

    await userEvent.click(screen.getByRole('button', { name: '1789' }));

    expect(await screen.findByText(/Goed — De Bastille werd in 1789 bestormd/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1789' })).toBeDisabled();
  });

  it('marks a wrong multiple choice answer', async () => {
    render(<AiQuizModal open setId="set-1" onClose={() => undefined} />);
    await screen.findByText('Wanneer begon de Franse Revolutie?');

    await userEvent.click(screen.getByRole('button', { name: '1917' }));

    expect(await screen.findByText(/Nog niet goed/i)).toBeInTheDocument();
  });

  it('renders true/false as two options', async () => {
    render(
      <AiQuizModal open setId="set-1" onClose={() => undefined} />,
    );
    await screen.findByText('Robespierre was een leider van de Terreur.');
    expect(screen.getByRole('button', { name: 'True' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'False' })).toBeInTheDocument();
  });

  it('judges an open answer with Lerno AI', async () => {
    evaluateMock.mockResolvedValue({
      verdict: 'correct',
      feedback: 'Klopt, de Bastille.',
      missing: '',
    });
    render(<AiQuizModal open setId="set-1" onClose={() => undefined} />);
    await screen.findByText('Welke gevangenis werd bestormd?');

    const input = screen.getByLabelText('Antwoord vraag 3');
    await userEvent.type(input, 'De Bastille');
    await userEvent.click(screen.getByRole('button', { name: 'Controleer' }));

    await waitFor(() =>
      expect(evaluateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          setId: 'set-1',
          question: 'Welke gevangenis werd bestormd?',
          expectedAnswer: 'De Bastille',
          answer: 'De Bastille',
        }),
      ),
    );
    expect(await screen.findByText(/Klopt, de Bastille/i)).toBeInTheDocument();
  });

  it('shows the final score once every question is answered', async () => {
    evaluateMock.mockResolvedValue({ verdict: 'correct', feedback: 'Goed', missing: '' });
    render(<AiQuizModal open setId="set-1" onClose={() => undefined} />);

    await screen.findByText('Wanneer begon de Franse Revolutie?');
    await userEvent.click(screen.getByRole('button', { name: '1789' }));
    await userEvent.click(screen.getByRole('button', { name: 'True' }));

    const input = screen.getByLabelText('Antwoord vraag 3');
    await userEvent.type(input, 'Bastille');
    await userEvent.click(screen.getByRole('button', { name: 'Controleer' }));

    expect(await screen.findByText('3 van 3 goed')).toBeInTheDocument();
  });

  it('lets the student pick the question types', async () => {
    render(<AiQuizModal open setId="set-1" onClose={() => undefined} />);
    await screen.findByText('Wanneer begon de Franse Revolutie?');

    await userEvent.click(screen.getByRole('button', { name: 'Open vragen' }));

    await waitFor(() =>
      expect(quizMock).toHaveBeenCalledWith(
        'set-1',
        10,
        ['multiple_choice', 'open'],
        'normal',
      ),
    );
  });

  it('shows a friendly error when the quiz cannot be generated', async () => {
    quizMock.mockRejectedValue(new ApiError('nope', 'AI_INVALID_CONTENT', 502));
    render(<AiQuizModal open setId="set-1" onClose={() => undefined} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not produce a usable answer/i);
  });
});
