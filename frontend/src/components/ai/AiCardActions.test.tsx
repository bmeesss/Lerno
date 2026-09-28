import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { aiLearningService } from '../../services/aiLearningService';
import { AiCardActions } from './AiCardActions';

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

const cardActionMock = vi.mocked(aiLearningService.cardAction);

function renderActions(signedIn = true) {
  return render(
    <MemoryRouter>
      <AiCardActions
        cardId="card-1"
        setId="set-1"
        signedIn={signedIn}
        label="Wat is fotosynthese?"
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  cardActionMock.mockResolvedValue({ text: 'Planten maken glucose uit licht.', action: 'explain' });
});

describe('AiCardActions', () => {
  it('offers the four card actions', async () => {
    renderActions();

    await userEvent.click(
      screen.getByRole('button', { name: 'Vraag AI over: Wat is fotosynthese?' }),
    );

    for (const label of ['Leg uit', 'Geef voorbeeld', 'Geef hint', 'Maak oefenvraag']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
  });

  it('explains the card and shows the answer in a modal', async () => {
    renderActions();

    await userEvent.click(
      screen.getByRole('button', { name: 'Vraag AI over: Wat is fotosynthese?' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Leg uit' }));

    expect(cardActionMock).toHaveBeenCalledWith('card-1', 'set-1', 'explain');
    expect(await screen.findByRole('heading', { name: 'Leg deze kaart uit' })).toBeInTheDocument();
    expect(await screen.findByText('Planten maken glucose uit licht.')).toBeInTheDocument();
  });

  it('asks for a hint without calling the AI as a guest', async () => {
    renderActions(false);

    await userEvent.click(
      screen.getByRole('button', { name: 'Vraag AI over: Wat is fotosynthese?' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Geef hint' }));

    expect(cardActionMock).not.toHaveBeenCalled();
  });

  it('shows a friendly error when the action fails', async () => {
    cardActionMock.mockRejectedValue(new ApiError('nope', 'AI_TIMEOUT', 504));
    renderActions();

    await userEvent.click(
      screen.getByRole('button', { name: 'Vraag AI over: Wat is fotosynthese?' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Maak oefenvraag' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/took too long/i);
  });

  it('retries the same action', async () => {
    cardActionMock
      .mockRejectedValueOnce(new ApiError('nope', 'AI_ERROR', 502))
      .mockResolvedValueOnce({ text: 'Nu wel.', action: 'example' });
    renderActions();

    await userEvent.click(
      screen.getByRole('button', { name: 'Vraag AI over: Wat is fotosynthese?' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Geef voorbeeld' }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: /Try again/i }));

    expect(await screen.findByText('Nu wel.')).toBeInTheDocument();
    await waitFor(() => expect(cardActionMock).toHaveBeenCalledTimes(2));
  });
});
