import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { aiLearningService } from '../../services/aiLearningService';
import { studySetService } from '../../services/studySetService';
import { AiGenerateSetModal } from './AiGenerateSetModal';

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
  studySetService: { create: vi.fn() },
}));

const generateMock = vi.mocked(aiLearningService.generateSet);
const createMock = vi.mocked(studySetService.create);

const generated = {
  title: 'Franse Revolutie',
  description: 'Kernfeiten voor 3 mavo',
  cards: [
    { front: 'Wanneer begon de Franse Revolutie?', back: '1789' },
    { front: 'Wie was Robespierre?', back: 'Een leider van de Terreur' },
  ],
};

function renderModal() {
  return render(
    <MemoryRouter>
      <AiGenerateSetModal open onClose={() => undefined} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  generateMock.mockResolvedValue(generated);
  createMock.mockResolvedValue({ id: 'new-set' } as never);
});

describe('AiGenerateSetModal', () => {
  it('shows a preview of the generated cards before saving', async () => {
    renderModal();

    await userEvent.type(
      screen.getByPlaceholderText(/Maak een flashcardset/i),
      'Maak een set over de Franse Revolutie voor 3 mavo',
    );
    await userEvent.click(screen.getByRole('button', { name: /Genereer/i }));

    expect(generateMock).toHaveBeenCalledWith(
      'Maak een set over de Franse Revolutie voor 3 mavo',
      12,
      '',
    );

    // Preview: both cards are visible with their answers.
    expect(await screen.findByDisplayValue('Wanneer begon de Franse Revolutie?')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1789')).toBeInTheDocument();
    // Nothing saved yet.
    expect(createMock).not.toHaveBeenCalled();
  });

  it('saves only after the student confirms', async () => {
    const onSaved = vi.fn();
    render(
      <MemoryRouter>
        <AiGenerateSetModal open onClose={() => undefined} onSaved={onSaved} />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByPlaceholderText(/Maak een flashcardset/i), 'Franse Revolutie');
    await userEvent.click(screen.getByRole('button', { name: /Genereer/i }));
    await screen.findByDisplayValue('1789');

    await userEvent.click(screen.getByRole('button', { name: /Set opslaan \(2\)/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Franse Revolutie',
        cards: [
          { question: 'Wanneer begon de Franse Revolutie?', answer: '1789' },
          { question: 'Wie was Robespierre?', answer: 'Een leider van de Terreur' },
        ],
      }),
    );
    expect(onSaved).toHaveBeenCalledWith('new-set');
  });

  it('lets the student remove a card from the preview', async () => {
    renderModal();

    await userEvent.type(screen.getByPlaceholderText(/Maak een flashcardset/i), 'Franse Revolutie');
    await userEvent.click(screen.getByRole('button', { name: /Genereer/i }));
    await screen.findByDisplayValue('1789');

    await userEvent.click(screen.getByRole('button', { name: 'Verwijder kaart 1' }));

    expect(screen.queryByDisplayValue('1789')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set opslaan \(1\)/i })).toBeInTheDocument();
  });

  it('lets the student edit a card before saving', async () => {
    renderModal();

    await userEvent.type(screen.getByPlaceholderText(/Maak een flashcardset/i), 'Franse Revolutie');
    await userEvent.click(screen.getByRole('button', { name: /Genereer/i }));
    const field = await screen.findByDisplayValue('1789');
    await userEvent.clear(field);
    await userEvent.type(field, '1792');

    await userEvent.click(screen.getByRole('button', { name: /Set opslaan \(2\)/i }));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cards: [
          { question: 'Wanneer begon de Franse Revolutie?', answer: '1792' },
          { question: 'Wie was Robespierre?', answer: 'Een leider van de Terreur' },
        ],
      }),
    );
  });

  it('shows a friendly error when generation fails', async () => {
    generateMock.mockRejectedValue(new ApiError('nope', 'AI_INVALID_CONTENT', 502));
    renderModal();

    await userEvent.type(screen.getByPlaceholderText(/Maak een flashcardset/i), 'Franse Revolutie');
    await userEvent.click(screen.getByRole('button', { name: /Genereer/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not produce a usable answer/i);
  });

  it('refuses to generate from a too short prompt', async () => {
    renderModal();

    await userEvent.type(screen.getByPlaceholderText(/Maak een flashcardset/i), 'bio');
    await userEvent.click(screen.getByRole('button', { name: /Genereer/i }));

    expect(generateMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/paar woorden/i);
  });
});
