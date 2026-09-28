import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aiService, type AiChatReply } from '../../services/aiService';
import { LernoAiPage } from './LernoAiPage';

vi.mock('../../services/aiService', () => ({
  aiService: { chat: vi.fn() },
  AI_HISTORY_LIMIT: 12,
}));

const chatMock = vi.mocked(aiService.chat);

function resolveReply(text: string): Promise<AiChatReply> {
  return Promise.resolve({ reply: text });
}

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(chatMock).toHaveBeenCalledWith('Leg fotosynthese uit', []);

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
    expect(chatMock).toHaveBeenCalledWith('Eerste regel\nTweede regel', []);
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

    // Enter while loading must not fire a second request
    await userEvent.type(input, 'nog een poging');
    await userEvent.keyboard('{Enter}');
    expect(chatMock).toHaveBeenCalledTimes(1);

    release({ reply: 'Klaar' });
    expect(await screen.findByText('Klaar')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
    // The question typed while loading is still in the input, ready to send
    expect(input).toHaveValue('nog een poging');
  });

  it('shows a clear error and restores the message when sending fails', async () => {
    chatMock.mockRejectedValueOnce(new Error('Lerno AI is not available right now'));
    render(<LernoAiPage />);

    const input = screen.getByLabelText('Your question for Lerno AI');
    await userEvent.type(input, 'Mijn vraag');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Lerno AI is not available right now');
    // The typed question is back in the input, nothing is lost
    expect(input).toHaveValue('Mijn vraag');
    // No assistant bubble was added
    expect(screen.queryByText('Lerno AI is typing')).not.toBeInTheDocument();
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
    expect(chatMock).toHaveBeenLastCalledWith('En wat doet chlorofyl?', [
      { role: 'user', content: 'Leg fotosynthese uit' },
      { role: 'assistant', content: 'Antwoord 1' },
    ]);
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

    await userEvent.click(
      screen.getByRole('button', { name: 'Leg fotosynthese uit op mavo 3 niveau' }),
    );
    expect(screen.getByLabelText('Your question for Lerno AI')).toHaveValue(
      'Leg fotosynthese uit op mavo 3 niveau',
    );
  });
});
