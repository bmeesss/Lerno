import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { aiLearningService } from '../../services/aiLearningService';
import { AiQuestionsModal } from './AiQuestionsModal';

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

const questionsMock = vi.mocked(aiLearningService.generateQuestions);
const hintMock = vi.mocked(aiLearningService.hint);

const questions = [
  {
    type: 'open' as const,
    question: 'Wat is fotosynthese?',
    answer: 'Planten maken glucose uit licht',
    hint: 'Denk aan licht',
    options: [],
    correctIndex: null,
    cardId: 'card-1',
  },
  {
    type: 'open' as const,
    question: 'Wat is chlorofyl?',
    answer: 'Groene kleurstof',
    hint: 'Kleur',
    options: [],
    correctIndex: null,
    cardId: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  questionsMock.mockResolvedValue({
    questions,
    meta: { setId: 'set-1', totalCards: 8, contextCards: 8, omittedCards: 0 },
  });
});

describe('AiQuestionsModal', () => {
  it('generates questions when opened and renders them', async () => {
    render(<AiQuestionsModal open setId="set-1" onClose={() => undefined} />);

    expect(questionsMock).toHaveBeenCalledWith('set-1', 10, 'normal');
    expect(await screen.findByText('Wat is fotosynthese?')).toBeInTheDocument();
    expect(screen.getByText('Wat is chlorofyl?')).toBeInTheDocument();
  });

  it('reveals the answer of one question only', async () => {
    render(<AiQuestionsModal open setId="set-1" onClose={() => undefined} />);
    await screen.findByText('Wat is fotosynthese?');

    const [firstToggle] = screen.getAllByRole('button', { name: 'Toon antwoord' });
    await userEvent.click(firstToggle!);

    expect(screen.getByText('Planten maken glucose uit licht')).toBeInTheDocument();
    expect(screen.queryByText('Groene kleurstof')).not.toBeInTheDocument();
  });

  it('asks Lerno AI for a hint and shows it', async () => {
    hintMock.mockResolvedValue({ hint: 'Denk aan wat bladeren met zonlicht doen.' });
    render(<AiQuestionsModal open setId="set-1" onClose={() => undefined} />);
    await screen.findByText('Wat is fotosynthese?');

    const [hintButton] = screen.getAllByRole('button', { name: 'Hint' });
    await userEvent.click(hintButton!);

    await waitFor(() =>
      expect(hintMock).toHaveBeenCalledWith(
        expect.objectContaining({ setId: 'set-1', cardId: 'card-1', hintsGiven: 0 }),
      ),
    );
    expect(
      await screen.findByText(/Denk aan wat bladeren met zonlicht doen/i),
    ).toBeInTheDocument();
  });

  it('lets the student pick the number of questions and level', async () => {
    render(<AiQuestionsModal open setId="set-1" onClose={() => undefined} />);
    await screen.findByText('Wat is fotosynthese?');

    await userEvent.click(screen.getByRole('button', { name: '5 vragen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Moeilijk' }));

    await waitFor(() => expect(questionsMock).toHaveBeenCalledWith('set-1', 5, 'hard'));
    expect(screen.getByRole('button', { name: '5 vragen' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows a friendly error when generation fails', async () => {
    questionsMock.mockRejectedValue(new ApiError('busy', 'RATE_LIMITED', 429));
    render(<AiQuestionsModal open setId="set-1" onClose={() => undefined} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Wait a moment and try again/i);
    expect(alert).not.toHaveTextContent('429');
  });
});
