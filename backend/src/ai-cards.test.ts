/**
 * Card-level AI actions (#8): only the selected card is sent as context, and
 * only cards the caller may see can be used.
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';

const { createCompletion } = vi.hoisted(() => ({ createCompletion: vi.fn() }));

vi.mock('groq-sdk', () => {
  class Groq {
    chat = { completions: { create: createCompletion } };
    constructor(_options: unknown) {}
  }
  return { default: Groq };
});

const mutableConfig = config as unknown as { groqApiKey: string };
const app = createApp();

let counter = 0;

async function signup(): Promise<string> {
  counter += 1;
  const email = `aicard${counter}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: 'Card Student' });
  return res.body.data.accessToken as string;
}

async function createSet(
  token: string,
  visibility: 'private' | 'public' = 'private',
): Promise<{ setId: string; cardIds: string[] }> {
  const res = await request(app)
    .post('/api/sets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Fotosynthese',
      level: 'havo 4',
      visibility,
      cards: [
        { question: 'Wat is fotosynthese?', answer: 'Planten maken glucose uit licht' },
        { question: 'Wat is chlorofyl?', answer: 'De groene kleurstof in bladeren' },
      ],
    });
  return {
    setId: res.body.data.id as string,
    cardIds: (res.body.data.cards as { id: string }[]).map((card) => card.id),
  };
}

function reply(content: string): unknown {
  return { choices: [{ index: 0, message: { role: 'assistant', content } }] };
}

function lastPayload(): { messages: { role: string; content: string }[] } {
  return createCompletion.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
}

beforeEach(() => {
  mutableConfig.groqApiKey = 'test-groq-key';
  createCompletion.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/ai/cards/:cardId/action', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post('/api/ai/cards/00000000-0000-4000-8000-000000000000/action')
      .send({ setId: '00000000-0000-4000-8000-000000000001', action: 'explain' });
    expect(res.status).toBe(401);
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('explains the card and sends only that card as context', async () => {
    const token = await signup();
    const { setId, cardIds } = await createSet(token);
    createCompletion.mockResolvedValue(reply('Fotosynthese zet licht om in glucose.'));

    const res = await request(app)
      .post(`/api/ai/cards/${cardIds[0]}/action`)
      .set('Authorization', `Bearer ${token}`)
      .send({ setId, action: 'explain' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      text: 'Fotosynthese zet licht om in glucose.',
      action: 'explain',
    });

    const userMessage = lastPayload().messages.at(-1)!.content;
    expect(userMessage).toContain('Wat is fotosynthese?');
    // The other card of the set is not part of the context.
    expect(userMessage).not.toContain('chlorofyl');
  });

  it('supports example, hint and practice actions', async () => {
    const token = await signup();
    const { setId, cardIds } = await createSet(token);

    for (const action of ['example', 'hint', 'practice']) {
      createCompletion.mockResolvedValue(reply(`Antwoord voor ${action}`));
      const res = await request(app)
        .post(`/api/ai/cards/${cardIds[1]}/action`)
        .set('Authorization', `Bearer ${token}`)
        .send({ setId, action });

      expect(res.status).toBe(200);
      expect(res.body.data.action).toBe(action);
      expect(res.body.data.text).toBe(`Antwoord voor ${action}`);
    }
  });

  it('rejects an unknown action with 400', async () => {
    const token = await signup();
    const { setId, cardIds } = await createSet(token);

    const res = await request(app)
      .post(`/api/ai/cards/${cardIds[0]}/action`)
      .set('Authorization', `Bearer ${token}`)
      .send({ setId, action: 'delete-everything' });

    expect(res.status).toBe(400);
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('reports a card from another set as not found', async () => {
    const owner = await signup();
    const other = await signup();
    const { cardIds } = await createSet(owner);
    const { setId } = await createSet(other);

    const res = await request(app)
      .post(`/api/ai/cards/${cardIds[0]}/action`)
      .set('Authorization', `Bearer ${other}`)
      .send({ setId, action: 'explain' });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Card not found');
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("blocks card actions on another user's private set", async () => {
    const owner = await signup();
    const other = await signup();
    const { setId, cardIds } = await createSet(owner, 'private');

    const res = await request(app)
      .post(`/api/ai/cards/${cardIds[0]}/action`)
      .set('Authorization', `Bearer ${other}`)
      .send({ setId, action: 'explain' });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Study set not found');
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('allows card actions on a public set another user can see', async () => {
    const owner = await signup();
    const other = await signup();
    const { setId, cardIds } = await createSet(owner, 'public');
    createCompletion.mockResolvedValue(reply('Iedereen mag dit leren.'));

    const res = await request(app)
      .post(`/api/ai/cards/${cardIds[0]}/action`)
      .set('Authorization', `Bearer ${other}`)
      .send({ setId, action: 'explain' });

    expect(res.status).toBe(200);
  });

  it('rejects a non-uuid card id like the other routes', async () => {
    const token = await signup();
    const { setId } = await createSet(token);

    const res = await request(app)
      .post('/api/ai/cards/nope/action')
      .set('Authorization', `Bearer ${token}`)
      .send({ setId, action: 'explain' });

    expect(res.status).toBe(400);
  });

  it('maps an upstream timeout to AI_TIMEOUT', async () => {
    const token = await signup();
    const { setId, cardIds } = await createSet(token);
    const timeout = new Error('upstream slow');
    timeout.name = 'APIConnectionTimeoutError';
    createCompletion.mockRejectedValue(timeout);

    const res = await request(app)
      .post(`/api/ai/cards/${cardIds[0]}/action`)
      .set('Authorization', `Bearer ${token}`)
      .send({ setId, action: 'explain' });

    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('AI_TIMEOUT');
  });
});
