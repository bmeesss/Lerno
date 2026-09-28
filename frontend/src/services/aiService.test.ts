import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../lib/api';
import { AI_HISTORY_LIMIT, AI_MAX_HISTORY_ITEM_CHARS, aiService, trimHistory } from './aiService';

vi.mock('../lib/api', () => ({
  apiRequest: vi.fn(),
  getAccessToken: vi.fn(() => null),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
}));

const requestMock = vi.mocked(apiRequest);

beforeEach(() => {
  vi.clearAllMocks();
  requestMock.mockResolvedValue({ reply: 'ok' });
});

describe('aiService.chat', () => {
  it('posts the message and history to the backend endpoint', async () => {
    await aiService.chat('Hallo', [{ role: 'user', content: 'Vraag' }]);

    expect(requestMock).toHaveBeenCalledWith('/ai/chat', {
      method: 'POST',
      body: { message: 'Hallo', history: [{ role: 'user', content: 'Vraag' }] },
      signal: undefined,
    });
  });

  it('defaults to an empty history', async () => {
    await aiService.chat('Hallo');
    expect(requestMock).toHaveBeenCalledWith(
      '/ai/chat',
      expect.objectContaining({ body: { message: 'Hallo', history: [] } }),
    );
  });

  it('sends an abort signal so a hung request can be cancelled', async () => {
    const controller = new AbortController();
    await aiService.chat('Hallo', [], controller.signal);
    expect(requestMock).toHaveBeenCalledWith(
      '/ai/chat',
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});

describe('trimHistory', () => {
  it('keeps only the newest messages', () => {
    const history = Array.from({ length: 30 }, (_, index) => ({
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `bericht ${index}`,
    }));

    const trimmed = trimHistory(history);

    expect(trimmed).toHaveLength(AI_HISTORY_LIMIT);
    expect(trimmed.at(-1)!.content).toBe('bericht 29');
    expect(trimmed[0]!.content).toBe(`bericht ${30 - AI_HISTORY_LIMIT}`);
  });

  it('shortens an oversized message so the request stays valid', () => {
    const trimmed = trimHistory([
      { role: 'assistant', content: 'x'.repeat(AI_MAX_HISTORY_ITEM_CHARS + 500) },
    ]);

    expect(trimmed[0]!.content.length).toBeLessThanOrEqual(AI_MAX_HISTORY_ITEM_CHARS);
    expect(trimmed[0]!.content.endsWith('[…]')).toBe(true);
  });

  it('is applied inside chat so the page cannot send an invalid payload', async () => {
    await aiService.chat('Hallo', [
      { role: 'assistant', content: 'y'.repeat(AI_MAX_HISTORY_ITEM_CHARS + 10) },
    ]);

    const sent = requestMock.mock.calls[0]![1] as {
      body: { history: { content: string }[] };
    };
    expect(sent.body.history[0]!.content.length).toBeLessThanOrEqual(AI_MAX_HISTORY_ITEM_CHARS);
  });
});
