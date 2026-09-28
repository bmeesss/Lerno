import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { aiService, type AiChatReply } from '../../services/aiService';
import { LernoAiPage } from './LernoAiPage';

// Keep the real module constants (timeouts, limits) and only stub the network.
vi.mock('../../services/aiService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/aiService')>();
  return { ...actual, aiService: { chat: vi.fn() } };
});

const chatMock = vi.mocked(aiService.chat);

function resolveReply(text: string): Promise<AiChatReply> {
  return Promise.resolve({ reply: text });
}

const SUGGESTION_LABELS = [
  'Leg dit simpel uit',
  'Maak oefenvragen',
  'Overhoor mij',
  'Help met deze som',
];

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('LernoAiPage', () => {
  it('sends the question and renders the AI answer readably', async () => {
    chatMock.mockImplementation(() =>
      resolveReply('**Fotosynthese** werkt zo:\n1. Licht\n2. Water'),
    );
    render(<LernoAiPage />);

    const input = screen.getByLabelText('Your question for Lerno AI');
    await userEvent.type(input, 'Leg fotosynthese uit');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(chatMock).toHaveBeenCalledWith('Leg fotosynthese uit', [], expect.anything());

    // Markdown renders: bold as strong, list items as list entries
    expect(await screen.findByText('Fotosynthese')).toBeInTheDocument();
    expect(screen.getByText('Licht')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.classList.contains('ai-md-paragraph') === true &&
          element.textContent === 'Fotosynthese werkt zo:',
      ),
    ).toBeInTheDocument();
  });

  it('sends with Enter and allows Shift+Enter for a new line', async () => {
    chatMock.mockImplementation(() => resolveReply('Antwoord'));
    render(<LernoAiPage />);

    const input = screen.getByLabelText('Your question for Lerno AI');
    await userEvent.type(input, 'Eerste regel');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(chatMock).not.toHaveBeenCalled();
    await userEvent.type(input, 'Tweede regel');

    await userEvent.keyboard('{Enter}');
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(chatMock).toHaveBeenCalledWith('Eerste regel\nTweede regel', [], expect.anything());
  });

  it('shows a loading state and blocks duplicate requests while sending', async () => {
    let release: (value: AiChatReply) => void = () => undefined;
    chatMock.mockImplementation(
      () =>
        new Promise<AiChatReply>((resolve) => {
          release = resolve;
        }),
    );
    render(<LernoAiPage />);

    const input = screen.getByLabelText('Your question for Lerno AI');
    await userEvent.type(input, 'Vraag');
    const send = screen.getByRole('button', { name: 'Send message' });
    await userEvent.click(send);

    // Loading indicator visible, send disabled, input cleared
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(send).toBeDisabled();

    // Enter and clicks while loading must not fire a second request
    await userEvent.type(input, 'nog een poging');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(send);
    expect(chatMock).toHaveBeenCalledTimes(1);

    release({ reply: 'Klaar' });
    expect(await screen.findByText('Klaar')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
    // The question typed while loading is still in the input, ready to send
    expect(input).toHaveValue('nog een poging');
  });

  it('shows a clear error and restores the message when sending fails', async () => {
    chatMock.mockRejectedValueOnce(new ApiError('nope', 'AI_ERROR', 502));
    render(<LernoAiPage />);

    const input = screen.getByLabelText('Your question for Lerno AI');
    await userEvent.type(input, 'Mijn vraag');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('temporarily unavailable');
    // The typed question is back in the input, nothing is lost
    expect(input).toHaveValue('Mijn vraag');
    // No assistant bubble was added
    expect(screen.queryByText('Lerno AI is typing')).not.toBeInTheDocument();
  });

  it('explains rate limits and upstream problems in normal language', async () => {
    chatMock.mockRejectedValueOnce(new ApiError('slow down', 'RATE_LIMITED', 429));
    render(<LernoAiPage />);

    const input = screen.getByLabelText('Your question for Lerno AI');
    await userEvent.type(input, 'Vraag');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('sending questions a bit fast');
    expect(alert).not.toHaveTextContent('RATE_LIMITED');
    expect(alert).not.toHaveTextContent('429');
  });

  it('retries the restored question after an error', async () => {
    chatMock
      .mockRejectedValueOnce(new ApiError('nope', 'AI_TIMEOUT', 504))
      .mockImplementation(() => resolveReply('Nu wel een antwoord'));
    render(<LernoAiPage />);

    const input = screen.getByLabelText('Your question for Lerno AI');
    await userEvent.type(input, 'Waarom is de lucht blauw?');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('took too long');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Nu wel een antwoord')).toBeInTheDocument();
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(chatMock).toHaveBeenLastCalledWith('Waarom is de lucht blauw?', [], expect.anything());
  });

  it('keeps text typed while a failing request was in flight', async () => {
    let reject: (error: unknown) => void = () => undefined;
    chatMock.mockImplementation(
      () =>
        new Promise<AiChatReply>((_resolve, rejectFn) => {
          reject = rejectFn;
        }),
    );
    render(<LernoAiPage />);

    const input = screen.getByLabelText('Your question for Lerno AI');
    await userEvent.type(input, 'Eerste vraag');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // Start typing a second question while the first one is still running.
    await userEvent.type(input, 'Tweede vraag');
    reject(new ApiError('nope', 'AI_ERROR', 502));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(input).toHaveValue('Tweede vraag');
  });

  it('sends bounded conversation history on follow-up questions', async () => {
    chatMock.mockImplementationOnce(() => resolveReply('Antwoord 1'));
    render(<LernoAiPage />);

    const input = screen.getByLabelText('Your question for Lerno AI');
    await userEvent.type(input, 'Leg fotosynthese uit');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Antwoord 1')).toBeInTheDocument();

    await userEvent.type(input, 'En wat doet chlorofyl?');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(chatMock).toHaveBeenCalledTimes(2));
    expect(chatMock).toHaveBeenLastCalledWith(
      'En wat doet chlorofyl?',
      [
        { role: 'user', content: 'Leg fotosynthese uit' },
        { role: 'assistant', content: 'Antwoord 1' },
      ],
      expect.anything(),
    );
  });

  it('regenerates the last answer', async () => {
    chatMock
      .mockImplementationOnce(() => resolveReply('Eerste antwoord'))
      .mockImplementationOnce(() => resolveReply('Tweede antwoord'));
    render(<LernoAiPage />);

    const input = screen.getByLabelText('Your question for Lerno AI');
    await userEvent.type(input, 'Leg fotosynthese uit');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Eerste antwoord')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate answer' }));

    expect(await screen.findByText('Tweede antwoord')).toBeInTheDocument();
    expect(screen.queryByText('Eerste antwoord')).not.toBeInTheDocument();
    expect(chatMock).toHaveBeenCalledTimes(2);
    // The same question is asked again, with the same history (none here).
    expect(chatMock).toHaveBeenLastCalledWith('Leg fotosynthese uit', [], expect.anything());
  });

  it('copies an answer to the clipboard', async () => {
    chatMock.mockImplementation(() => resolveReply('Dit is het antwoord'));
    render(<LernoAiPage />);

    const input = screen.getByLabelText('Your question for Lerno AI');
    await userEvent.type(input, 'Vraag');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Dit is het antwoord')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Copy answer' }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Dit is het antwoord');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('starts a new chat, clearing the conversation', async () => {
    chatMock.mockImplementation(() => resolveReply('Antwoord'));
    render(<LernoAiPage />);

    const input = screen.getByLabelText('Your question for Lerno AI');
    await userEvent.type(input, 'Vraag');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Antwoord')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));

    expect(screen.queryByText('Antwoord')).not.toBeInTheDocument();
    expect(screen.getByText('What do you want to learn?')).toBeInTheDocument();
  });

  it('does not send empty questions', async () => {
    render(<LernoAiPage />);

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Your question for Lerno AI'), '   ');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('fills the input from a suggestion chip', async () => {
    render(<LernoAiPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Overhoor mij' }));
    const input = screen.getByLabelText('Your question for Lerno AI');
    expect(input).toHaveValue('Overhoor mij over ');
    expect(input).toHaveFocus();
  });

  it('shows all quick prompts as chips on the welcome state', () => {
    render(<LernoAiPage />);

    for (const label of SUGGESTION_LABELS) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('renders long answers completely', async () => {
    const longReply = Array.from(
      { length: 10 },
      (_, index) =>
        `## Stap ${index}\n\nUitleg ${index} met **vetdruk**.\n\n- punt ${index}a\n- punt ${index}b`,
    ).join('\n\n');
    chatMock.mockImplementation(() => resolveReply(longReply));
    const { container } = render(<LernoAiPage />);

    const input = screen.getByLabelText('Your question for Lerno AI');
    fireEvent.change(input, { target: { value: 'Leer mij alles over hoofdstuk 1' } });
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(container.querySelectorAll('.ai-md-heading')).toHaveLength(10));
    expect(container.querySelectorAll('.ai-md-list')).toHaveLength(10);
    expect(container.querySelector('.ai-markdown')?.textContent).toContain('Uitleg 9 met vetdruk.');
  });

  it('shows the character counter when the question gets long', () => {
    render(<LernoAiPage />);

    const input = screen.getByLabelText('Your question for Lerno AI');
    fireEvent.change(input, { target: { value: 'a'.repeat(1900) } });

    expect(screen.getByText('100 characters left')).toBeInTheDocument();
  });

  it('exposes the conversation to screen readers', async () => {
    let release: (value: AiChatReply) => void = () => undefined;
    chatMock.mockImplementation(
      () =>
        new Promise<AiChatReply>((resolve) => {
          release = resolve;
        }),
    );
    render(<LernoAiPage />);

    const log = screen.getByRole('log', { name: 'Conversation with Lerno AI' });
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(log).toHaveAttribute('aria-busy', 'false');

    const input = screen.getByLabelText('Your question for Lerno AI');
    await userEvent.type(input, 'Vraag');
    const send = screen.getByRole('button', { name: 'Send message' });
    await userEvent.click(send);

    // While generating, the log is busy and the send button is disabled.
    expect(log).toHaveAttribute('aria-busy', 'true');
    expect(send).toBeDisabled();

    release({ reply: 'Antwoord' });
    expect(await screen.findByText('Antwoord')).toBeInTheDocument();
    expect(log).toHaveAttribute('aria-busy', 'false');
  });
});
