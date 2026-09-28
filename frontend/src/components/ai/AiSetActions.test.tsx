import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { aiLearningService } from '../../services/aiLearningService';
import { AiSetActions } from './AiSetActions';

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

const explainMock = vi.mocked(aiLearningService.explainSet);
const summarizeMock = vi.mocked(aiLearningService.summarizeSet);

function renderActions(signedIn = true) {
  return render(
    <MemoryRouter>
      <AiSetActions setId="set-1" signedIn={signedIn} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AiSetActions', () => {
  it('opens the AI menu and explains the set', async () => {
    explainMock.mockResolvedValue({
      explanation: '## Kern\n\n- Fotosynthese maakt **glucose**.',
      meta: { setId: 'set-1', totalCards: 12, contextCards: 12, omittedCards: 0 },
    });
    renderActions();

    const trigger = screen.getByRole('button', { name: /Vraag Lerno AI/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Leg deze set uit' }));

    expect(explainMock).toHaveBeenCalledWith('set-1');
    expect(await screen.findByRole('heading', { name: 'Leg deze set uit' })).toBeInTheDocument();
    // Markdown from the AI renders as real elements.
    expect(await screen.findByText('Kern')).toBeInTheDocument();
    expect(screen.getByText('glucose')).toBeInTheDocument();
  });

  it('summarizes the set', async () => {
    summarizeMock.mockResolvedValue({
      explanation: '- 1789\n- Bastille',
      meta: { setId: 'set-1', totalCards: 8, contextCards: 8, omittedCards: 0 },
    });
    renderActions();

    await userEvent.click(screen.getByRole('button', { name: /Vraag Lerno AI/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Vat deze set samen' }));

    expect(summarizeMock).toHaveBeenCalledWith('set-1');
    expect(await screen.findByRole('heading', { name: 'Vat deze set samen' })).toBeInTheDocument();
    expect(await screen.findByText('Bastille')).toBeInTheDocument();
  });

  it('shows a loading state and then the answer', async () => {
    let resolve: (value: {
      explanation: string;
      meta: { setId: string; totalCards: number; contextCards: number; omittedCards: number };
    }) => void = () => undefined;
    explainMock.mockImplementation(
      () =>
        new Promise((resolveFn) => {
          resolve = resolveFn;
        }),
    );
    renderActions();

    await userEvent.click(screen.getByRole('button', { name: /Vraag Lerno AI/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Leg deze set uit' }));

    expect(screen.getByText(/Lerno AI leest je set/i)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();

    resolve({
      explanation: 'Klaar',
      meta: { setId: 'set-1', totalCards: 3, contextCards: 3, omittedCards: 0 },
    });

    expect(await screen.findByText('Klaar')).toBeInTheDocument();
  });

  it('shows a friendly error with a retry that works', async () => {
    explainMock
      .mockRejectedValueOnce(new ApiError('slow down', 'RATE_LIMITED', 429))
      .mockResolvedValueOnce({
        explanation: 'Nu wel een antwoord',
        meta: { setId: 'set-1', totalCards: 2, contextCards: 2, omittedCards: 0 },
      });
    renderActions();

    await userEvent.click(screen.getByRole('button', { name: /Vraag Lerno AI/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Leg deze set uit' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Wait a moment and try again/i);
    expect(alert).not.toHaveTextContent('RATE_LIMITED');

    await userEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(await screen.findByText('Nu wel een antwoord')).toBeInTheDocument();
    expect(explainMock).toHaveBeenCalledTimes(2);
  });

  it('explains a missing set without technical details', async () => {
    explainMock.mockRejectedValue(new ApiError('Study set not found', 'NOT_FOUND', 404));
    renderActions();

    await userEvent.click(screen.getByRole('button', { name: /Vraag Lerno AI/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Leg deze set uit' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not find that set/i);
    expect(alert).not.toHaveTextContent('404');
  });

  it('closes the menu with Escape', async () => {
    renderActions();
    const trigger = screen.getByRole('button', { name: /Vraag Lerno AI/i });

    await userEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('sends guests to the login page instead of calling the AI', async () => {
    renderActions(false);

    await userEvent.click(screen.getByRole('button', { name: /Vraag Lerno AI/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Leg deze set uit' }));

    expect(explainMock).not.toHaveBeenCalled();
  });
});
