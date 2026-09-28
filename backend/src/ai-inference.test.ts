/**
 * GPT-OSS inference settings: reasoning effort per task, the level in the
 * request context, the output budgets that follow from it, and what is logged.
 *
 * These are deterministic configuration tests — no model is called, and no
 * answer quality is claimed. They lock in *which settings are sent*, so a
 * measurement run can compare configurations honestly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEncoding } from 'js-tiktoken';
import { config } from './config.js';
import { buildChatRequest, buildConversation, askLernoAi } from './services/ai-service.js';
import {
  AI_TASKS,
  LEVEL_RULE,
  SIMPLICITY_RULE,
  STUDY_SYSTEM_PROMPT,
} from './services/ai-prompts.js';
import {
  chatReasoningEffort,
  defaultReasoningEffort,
  REASONING_RESERVE,
  resolveReasoningEffort,
  supportsReasoningEffort,
} from './services/ai-reasoning.js';
import {
  buildChatParams,
  completionBudget,
  requestChat,
  type ChatRequest,
} from './services/ai-completion.js';
import { levelDirective, selectChatContext } from './lib/ai-chat-context.js';
import type { AiChatMessage } from './validators/ai.validators.js';

// --- Groq SDK mock: the service must never hit the real API in tests -------
const { createCompletion } = vi.hoisted(() => ({ createCompletion: vi.fn() }));

vi.mock('groq-sdk', () => {
  class Groq {
    chat = { completions: { create: createCompletion } };
    constructor(_options: unknown) {}
  }
  return { default: Groq };
});

const mutableConfig = config as unknown as {
  groqApiKey: string;
  groqModel: string;
  groqMaxOutputTokens: number;
  groqReasoningEffort: 'auto' | 'low' | 'medium' | 'high';
};
const DEFAULT_MODEL = config.groqModel;
const DEFAULT_REASONING = config.groqReasoningEffort;
const encoder = getEncoding('o200k_base');

const mavoHistory: AiChatMessage[] = [
  { role: 'user', content: 'Ik zit in mavo 3. Leg fotosynthese uit.' },
  { role: 'assistant', content: 'Planten maken glucose uit licht, water en CO2.' },
];

function chatRequest(message: string, history: AiChatMessage[] = []): ChatRequest {
  return buildChatRequest(message, history);
}

beforeEach(() => {
  mutableConfig.groqApiKey = 'test-groq-key';
  mutableConfig.groqModel = DEFAULT_MODEL;
  mutableConfig.groqReasoningEffort = DEFAULT_REASONING;
  createCompletion.mockReset();
  createCompletion.mockResolvedValue({
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }],
    usage: { prompt_tokens: 210, completion_tokens: 90, total_tokens: 300 },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('reasoning effort for free chat', () => {
  it.each([
    ['Leg fotosynthese uit op mavo 3-niveau.', 'low'],
    ['Waarom is mijn gewicht op de maan kleiner?', 'low'],
    ['Geef één moeilijke vraag over massa en gewicht op mavo 3.', 'medium'],
    ['Los 3x + 7 = 22 stap voor stap op.', 'medium'],
    ['Leg de Franse Revolutie kort uit op mavo 3-niveau.', 'low'],
  ])('classifies %s as %s', (message, expected) => {
    expect(chatReasoningEffort(message)).toBe(expected);
    expect(chatRequest(message).reasoningEffort).toBe(expected);
  });

  it('keeps short answers, greetings and hints cheap', () => {
    for (const message of [
      'Hallo',
      'Wat is fotosynthese?',
      'Geef een hint',
      'Noem de drie fases van de fotosynthese',
    ]) {
      expect(chatReasoningEffort(message)).toBe('low');
    }
  });

  it('never spends high reasoning on a school question', () => {
    const questions = [
      'Leg alles uit over fotosynthese',
      'Los dit integraal stap voor stap op',
      'Maak een moeilijke quiz over de Franse Revolutie',
      'Leg dit zeer gedetailleerd uit in detail',
    ];
    for (const question of questions) expect(chatReasoningEffort(question)).not.toBe('high');
  });
});

describe('reasoning effort per task', () => {
  it('keeps explanation tasks low and generation/evaluation medium', () => {
    expect(AI_TASKS.explain.reasoning).toBe('low');
    expect(AI_TASKS.summarize.reasoning).toBe('low');
    expect(AI_TASKS.hint.reasoning).toBe('low');
    expect(AI_TASKS.card.reasoning).toBe('low');
    expect(AI_TASKS.questions.reasoning).toBe('medium');
    expect(AI_TASKS.cards.reasoning).toBe('medium');
    expect(AI_TASKS.quiz.reasoning).toBe('medium');
    expect(AI_TASKS.evaluate.reasoning).toBe('medium');
  });

  it('resolves the effort from the action, with low as the safe default', () => {
    expect(defaultReasoningEffort('hint')).toBe('low');
    expect(defaultReasoningEffort('quiz')).toBe('medium');
    expect(defaultReasoningEffort('something-new')).toBe('low');
    expect(resolveReasoningEffort({ action: 'evaluate' })).toBe('medium');
    expect(resolveReasoningEffort({ action: 'chat', reasoningEffort: 'medium' })).toBe('medium');
  });
});

describe('reasoning effort configuration', () => {
  it('is only sent to models that support it', () => {
    expect(supportsReasoningEffort('openai/gpt-oss-120b')).toBe(true);
    expect(supportsReasoningEffort('llama-3.3-70b-versatile')).toBe(false);
    expect(resolveReasoningEffort({ action: 'quiz' })).toBe('medium');

    mutableConfig.groqModel = 'llama-3.3-70b-versatile';
    expect(resolveReasoningEffort({ action: 'quiz' })).toBeNull();
    const params = buildChatParams({ action: 'quiz', messages: [], maxOutputTokens: 1200 });
    expect(params).not.toHaveProperty('reasoning_effort');
    expect(params.max_completion_tokens).toBe(1200);
  });

  it('lets GROQ_REASONING_EFFORT force one level for a measurement run', () => {
    mutableConfig.groqReasoningEffort = 'high';
    expect(resolveReasoningEffort({ action: 'hint' })).toBe('high');
    // The request keeps its classified value; the override is applied on the way
    // out, so one environment variable moves every request to the same level.
    expect(chatRequest('Hallo').reasoningEffort).toBe('low');
    expect(resolveReasoningEffort(chatRequest('Hallo'))).toBe('high');
    expect(resolveReasoningEffort({ action: 'hint', reasoningEffort: 'low' })).toBe('high');

    mutableConfig.groqReasoningEffort = 'low';
    expect(resolveReasoningEffort({ action: 'quiz' })).toBe('low');
  });
});

describe('output budget and reasoning reserve', () => {
  it('reserves headroom per effort level', () => {
    expect(REASONING_RESERVE.low).toBe(256);
    expect(REASONING_RESERVE.medium).toBeGreaterThan(REASONING_RESERVE.low);
    expect(REASONING_RESERVE.high).toBeGreaterThan(REASONING_RESERVE.medium);
  });

  it('keeps the visible budget and only adds the reserve on top', () => {
    expect(
      completionBudget({ action: 'explain', maxOutputTokens: 650, reasoningEffort: 'low' }),
    ).toBe(650 + REASONING_RESERVE.low);
    expect(completionBudget({ action: 'evaluate', maxOutputTokens: 220 })).toBe(
      220 + REASONING_RESERVE.medium,
    );
  });

  it('respects the chat ceiling, whatever the effort', () => {
    const chat = (reasoningEffort: 'low' | 'medium', maxOutputTokens = 800) =>
      completionBudget({ action: 'chat', maxOutputTokens, reasoningEffort });
    expect(chat('low')).toBe(800 + REASONING_RESERVE.low);
    expect(chat('medium')).toBe(800 + REASONING_RESERVE.medium);
    expect(chat('medium', 1800)).toBe(config.groqMaxOutputTokens);
    expect(chat('medium', 9000)).toBe(config.groqMaxOutputTokens);
  });

  it('sends the task settings upstream, not a flat guess', async () => {
    const simple = await requestChat(chatRequest('Waarom is mijn gewicht op de maan kleiner?'));
    const [simpleBody] = createCompletion.mock.calls[0]! as [Record<string, unknown>];
    expect(simpleBody.reasoning_effort).toBe('low');
    expect(simpleBody.max_completion_tokens).toBe(320 + REASONING_RESERVE.low);

    createCompletion.mockClear();
    const math = await requestChat(chatRequest('Los 3x + 7 = 22 stap voor stap op.'));
    const [mathBody] = createCompletion.mock.calls[0]! as [Record<string, unknown>];
    expect(mathBody.reasoning_effort).toBe('medium');
    expect(mathBody.max_completion_tokens).toBe(800 + REASONING_RESERVE.medium);

    expect(simple.reasoningEffort).toBe('low');
    expect(math.reasoningEffort).toBe('medium');
    expect(math.inputTokens).toBe(210);
  });
});

describe('school level in the request context', () => {
  it('sends the remembered level as one short line', () => {
    const [system] = buildConversation('En gewicht?', mavoHistory);
    expect(system!.content).toContain('Level: mavo 3.');
    expect(levelDirective('havo 4')).toBe(' Level: havo 4.');
    expect(levelDirective(null)).toBe('');
  });

  it('never promotes a student because a question is technically hard', () => {
    // The question does not state a level, so the remembered one is used: hard
    // means hard *within* mavo 3.
    const hard = 'Geef één moeilijke vraag over massa en gewicht.';
    expect(selectChatContext(hard, mavoHistory).level).toBe('mavo 3');
    const [system] = buildConversation(hard, mavoHistory);
    expect(system!.content).toContain('Level: mavo 3.');
    expect(system!.content).toContain(LEVEL_RULE);
  });

  it('does not repeat a level the question already states', () => {
    const [system] = buildConversation('Geef één moeilijke vraag over massa op mavo 3.', []);
    expect(system!.content).not.toContain('Level:');
    expect(system!.content.length).toBe(STUDY_SYSTEM_PROMPT.length);
  });

  it('lets an explicit new level replace the remembered one', () => {
    const [system] = buildConversation('Leg dit uit op vwo 5', mavoHistory);
    expect(system!.content).not.toContain('Level: mavo 3.');
    expect(system!.content).toContain(LEVEL_RULE);
    // The current message carries the level, so the system prompt stays compact.
    expect(system!.content.length).toBe(STUDY_SYSTEM_PROMPT.length);
  });

  it('falls back to a simple explanation when no level is known', () => {
    const [system] = buildConversation('Leg fotosynthese uit.', []);
    expect(system!.content).not.toContain('Level:');
    expect(system!.content).toContain('Without a level, start simple');
    expect(system!.content).toContain(SIMPLICITY_RULE);
  });

  it('keeps every task prompt level-aware and school-simple', () => {
    for (const task of Object.values(AI_TASKS)) {
      expect(task.system).toContain(LEVEL_RULE);
      expect(task.system).toContain(SIMPLICITY_RULE);
    }
  });
});

describe('prompt size guardrails', () => {
  it('does not grow the compact prompts into a wall of instructions', () => {
    // Generous upper bounds, not exact tokenizer snapshots: the point is that a
    // future prompt addition must be a deliberate, reviewed step.
    expect(encoder.encode(STUDY_SYSTEM_PROMPT).length).toBeLessThan(260);
    expect(STUDY_SYSTEM_PROMPT.length).toBeLessThan(1400);
    for (const task of Object.values(AI_TASKS)) {
      expect(encoder.encode(task.system).length).toBeLessThan(270);
    }
  });

  it('keeps a fresh chat small, with and without a level', () => {
    const withoutLevel = buildConversation('Hallo', []);
    const withLevel = buildConversation('En gewicht?', mavoHistory);
    for (const messages of [withoutLevel, withLevel]) {
      const total = 16 + messages.reduce((n, m) => n + encoder.encode(m.content).length + 12, 0);
      // The curriculum guard is compact; retain a small margin over the original 300-token fixture.
      expect(total).toBeLessThan(310);
    }
  });
});

describe('AI request observability', () => {
  it('logs the action, model, effort, duration and tokens — never content', async () => {
    vi.stubEnv('LOG_IN_TESTS', 'true');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await askLernoAi({ message: 'Los 3x + 7 = 22 stap voor stap op.', history: [] });
    createCompletion.mockRejectedValue(new Error('boom'));
    await askLernoAi({ message: 'Hallo', history: [] }).catch(() => undefined);

    const lines = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(lines).toContain('ai.action.completed');
    expect(lines).toContain('ai.action.failed');
    expect(lines).toContain('reasoningEffort');
    expect(lines).toContain('medium');
    expect(lines).toContain('inputTokens');
    expect(lines).toContain('durationMs');
    expect(lines).toContain(DEFAULT_MODEL);
    // Never the prompt, the answer or the key.
    expect(lines).not.toContain('stap voor stap');
    expect(lines).not.toContain('test-groq-key');
  });
});
