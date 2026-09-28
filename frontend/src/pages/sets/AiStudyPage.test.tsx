import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { aiLearningService } from '../../services/aiLearningService';
import { studySetService } from '../../services/studySetService';
import { AiStudyPage } from './AiStudyPage';

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

vi.mock('../../services/studySetService', () => ({
  studySetService: { get: vi.fn() },
}));

const questionsMock = vi.mocked(aiLearningService.generateQuestions);
const evaluateMock = vi.mocked(aiLearningService.evaluateAnswer);
const hintMock = vi.mocked(aiLearningService.hint);
const finishMock = vi.mocked(aiLearningService.finishStudy);
const setMock = vi.mocked(studySetService.get);

const studySet = {
  id: 'set-1',
  ownerId: 'user-1',
  subjectId: null,
  subjectName: 'Biologie',
  title: 'Fotosynthese',
  slug: 'fotosynthese',
  description: 'H4',
  level: 'havo 4',
  visibility: 'private' as const,
  tags: [],
  cardCount: 2,
  authorName: 'Student',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  isOwner: true,
  favorited: false,
  cards: [
    { id: 'card-1', question: 'Wat is fotosynthese?', answer: 'glucose', position: 0 },
    { id: 'card-2', question: 'Wat is chlorofyl?', answer: 'groene kleurstof', position: 1 },
  ],
};

const aiQuestions = [
  {
    type: 'open' as const,
    question: 'Wat is fotosynthese?',
    answer: 'Planten maken glucose uit licht',
    hint: 'Zonlicht',
    options: [],
    correctIndex: null,
    cardId: 'card-1',
  },
  {
    type: 'open' as const,
    question: 'Wat is chlorofyl?',
    answer: 'De groene kleurstof',
    hint: 'Kleur',
    options: [],
    correctIndex: null,
    cardId: 'card-2',
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/sets/set-1/ai-study']}>
      <Routes>
        <Route path="/sets/:setId/ai-study" element={<AiStudyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setMock.mockResolvedValue(studySet);
  questionsMock.mockResolvedValue({
    questions: aiQuestions,
    meta: { setId: 'set-1', totalCards: 2, contextCards: 2, omittedCards: 0 },
  });
});

describe('AiStudyPage (Overhoor mij)', () => {
  it('starts a session and asks the first question', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Overhoor mij' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start overhoring' }));

    expect(questionsMock).toHaveBeenCalledWith('set-1', 10, 'normal');
    expect(await screen.findByText('Wat is fotosynthese?')).toBeInTheDocument();
    expect(screen.getByText('Vraag 1 van 2')).toBeInTheDocument();
  });

  it('evaluates an answer, shows feedback and continues to the next question', async () => {
    evaluateMock.mockResolvedValue({ verdict: 'correct', feedback: 'Precies!', missing: '' });
    renderPage();
    await screen.findByRole('heading', { name: 'Overhoor mij' });

    await userEvent.click(screen.getByRole('button', { name: 'Start overhoring' }));
    const input = await screen.findByLabelText('Je antwoord');
    await userEvent.type(input, 'Planten maken glucose uit licht');
    await userEvent.click(screen.getByRole('button', { name: 'Controleer' }));

    expect(evaluateMock).toHaveBeenCalledWith(
      expect.objectContaining({ setId: 'set-1', cardId: 'card-1' }),
    );
    expect(await screen.findByText('Goed')).toBeInTheDocument();
    expect(screen.getByText('Precies!')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Volgende vraag/i }));
    expect(await screen.findByText('Wat is chlorofyl?')).toBeInTheDocument();
  });

  it('shows partial and incorrect feedback distinctly', async () => {
    evaluateMock.mockResolvedValue({
      verdict: 'partial',
      feedback: 'Je noemt het licht, maar niet glucose.',
      missing: 'glucose',
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Overhoor mij' });
    await userEvent.click(screen.getByRole('button', { name: 'Start overhoring' }));

    await userEvent.type(await screen.findByLabelText('Je antwoord'), 'zon');
    await userEvent.click(screen.getByRole('button', { name: 'Controleer' }));

    expect(await screen.findByText('Gedeeltelijk goed')).toBeInTheDocument();
    expect(screen.getByText('Nog niet genoemd: glucose')).toBeInTheDocument();
  });

  it('gives a hint that is shown before answering', async () => {
    hintMock.mockResolvedValue({ hint: 'Denk aan wat planten uit licht halen.' });
    renderPage();
    await screen.findByRole('heading', { name: 'Overhoor mij' });
    await userEvent.click(screen.getByRole('button', { name: 'Start overhoring' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Hint' }));

    expect(await screen.findByText(/Denk aan wat planten uit licht halen/i)).toBeInTheDocument();
    expect(hintMock).toHaveBeenCalledWith(expect.objectContaining({ hintsGiven: 0 }));
  });

  it('finishes the session and shows the result with topics to review', async () => {
    evaluateMock
      .mockResolvedValueOnce({ verdict: 'correct', feedback: 'Goed!', missing: '' })
      .mockResolvedValueOnce({
        verdict: 'incorrect',
        feedback: 'Nee, chlorofyl is de kleurstof.',
        missing: 'kleurstof',
      });
    finishMock.mockResolvedValue({
      setId: 'set-1',
      total: 2,
      correct: 1,
      partial: 0,
      incorrect: 1,
      accuracy: 0.5,
      topicsToReview: ['Wat is chlorofyl?'],
      persisted: true,
    });

    renderPage();
    await screen.findByRole('heading', { name: 'Overhoor mij' });
    await userEvent.click(screen.getByRole('button', { name: 'Start overhoring' }));

    // Question 1
    await userEvent.type(await screen.findByLabelText('Je antwoord'), 'glucose');
    await userEvent.click(screen.getByRole('button', { name: 'Controleer' }));
    await screen.findByText('Goed');
    await userEvent.click(screen.getByRole('button', { name: /Volgende vraag/i }));

    // Question 2
    await userEvent.type(await screen.findByLabelText('Je antwoord'), 'geen idee');
    await userEvent.click(screen.getByRole('button', { name: 'Controleer' }));
    await screen.findByText('Nog niet goed');
    await userEvent.click(screen.getByRole('button', { name: /Bekijk resultaat/i }));

    expect(await screen.findByText('Klaar!')).toBeInTheDocument();
    expect(finishMock).toHaveBeenCalledWith({
      setId: 'set-1',
      results: [
        { cardId: 'card-1', question: 'Wat is fotosynthese?', answer: 'glucose', verdict: 'correct' },
        {
          cardId: 'card-2',
          question: 'Wat is chlorofyl?',
          answer: 'geen idee',
          verdict: 'incorrect',
        },
      ],
    });
    expect(screen.getByText('1 correct')).toBeInTheDocument();
    expect(screen.getByText('1 fout')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Onderwerpen om opnieuw te oefenen' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Wat is chlorofyl?')).toBeInTheDocument();
    expect(screen.getByText(/verwerkt in je normale studievoortgang/i)).toBeInTheDocument();
  });

  it('keeps the normal study flow reachable', async () => {
    renderPage();
    expect(
      await screen.findByRole('link', { name: /normale studiemodus/i }),
    ).toHaveAttribute('href', '/sets/set-1/study');
  });

  it('shows a friendly error when the questions cannot be generated', async () => {
    questionsMock.mockRejectedValue(new ApiError('nope', 'AI_INVALID_CONTENT', 502));
    renderPage();
    await screen.findByRole('heading', { name: 'Overhoor mij' });

    await userEvent.click(screen.getByRole('button', { name: 'Start overhoring' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not produce a usable answer/i);
  });

  it('does not enable checking an empty answer', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Overhoor mij' });
    await userEvent.click(screen.getByRole('button', { name: 'Start overhoring' }));

    expect(await screen.findByRole('button', { name: 'Controleer' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Je antwoord'), '   ');
    expect(screen.getByRole('button', { name: 'Controleer' })).toBeDisabled();
  });
});
