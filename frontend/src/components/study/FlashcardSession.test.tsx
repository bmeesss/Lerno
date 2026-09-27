import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { FlashcardSession } from './FlashcardSession';

const cards = [
  { id: 'c1', question: 'What is 2+2?', answer: '4' },
  { id: 'c2', question: 'Capital of France?', answer: 'Paris' },
];

function renderSession(overrides: Partial<Parameters<typeof FlashcardSession>[0]> = {}) {
  const onReview = vi.fn().mockResolvedValue(undefined);
  const onDone = vi.fn();
  render(
    <ToastProvider>
      <FlashcardSession cards={cards} onReview={onReview} onDone={onDone} {...overrides} />
    </ToastProvider>,
  );
  return { onReview, onDone };
}

describe('FlashcardSession', () => {
  it('shows the question, reveals the answer, and records a correct result', async () => {
    const { onReview } = renderSession();
    expect(screen.getByText('What is 2+2?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /show answer/i }));
    expect(screen.getByText('4')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^correct$/i }));
    expect(onReview).toHaveBeenCalledWith('c1', 'correct');
    // Advances to the second card
    expect(screen.getByText('Capital of France?')).toBeInTheDocument();
  });

  it('requeues incorrect cards into the session', async () => {
    const { onReview } = renderSession();
    await userEvent.click(screen.getByRole('button', { name: /show answer/i }));
    await userEvent.click(screen.getByRole('button', { name: /incorrect/i }));
    expect(onReview).toHaveBeenCalledWith('c1', 'incorrect');

    // Second card first, then the failed card returns
    expect(screen.getByText('Capital of France?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /show answer/i }));
    await userEvent.click(screen.getByRole('button', { name: /^correct$/i }));
    expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
  });

  it('supports keyboard controls: space reveals, arrows answer', async () => {
    const user = userEvent.setup();
    const { onReview } = renderSession();

    // Answers are ignored before reveal.
    await user.keyboard('2');
    expect(onReview).not.toHaveBeenCalled();

    await user.keyboard(' ');
    expect(screen.getByText('4')).toBeInTheDocument();

    await user.keyboard('{ArrowRight}');
    expect(onReview).toHaveBeenCalledWith('c1', 'correct');
    expect(screen.getByText('Capital of France?')).toBeInTheDocument();

    await user.keyboard(' ');
    await user.keyboard('{ArrowLeft}');
    expect(onReview).toHaveBeenCalledWith('c2', 'incorrect');
  });

  it('finishes with a summary when every card is correct', async () => {
    const { onDone } = renderSession();
    for (const _ of cards) {
      await userEvent.click(screen.getByRole('button', { name: /show answer/i }));
      await userEvent.click(screen.getByRole('button', { name: /^correct$/i }));
    }
    expect(onDone).toHaveBeenCalledWith({ total: 2, correct: 2, incorrect: 0 });
  });
});
