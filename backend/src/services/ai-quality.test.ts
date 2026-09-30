import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getEncoding } from 'js-tiktoken';
import {
  CURRICULUM_QUALITY_CASES,
  QUALITY_CASES,
  curriculumQualitySignals,
  qualitySignals,
} from '../../scripts/fixtures/ai-quality.js';
import { askLernoAi, buildChatRequest } from './ai-service.js';
import { AI_TASKS, CURRICULUM_RULE, STUDY_SYSTEM_PROMPT, taskMessages } from './ai-prompts.js';
import { chatContextSource } from '../lib/ai-chat-context.js';
import { requestChat } from './ai-completion.js';
import { cleanAiText } from '../lib/ai-text.js';

vi.mock('./ai-completion.js', async (original) => ({
  ...(await original<typeof import('./ai-completion.js')>()),
  requestChat: vi.fn(),
}));

beforeEach(() => vi.mocked(requestChat).mockReset());

// Tests of our probes and plumbing, NOT evidence of live model correctness.
describe('school quality regression probes', () => {
  it.each(QUALITY_CASES)(
    '$subject / $id: accepts correct content and flags known failure',
    (example) => {
      expect(Object.values(qualitySignals(example, example.good)).every(Boolean)).toBe(true);
      expect(Object.values(qualitySignals(example, example.bad)).every(Boolean)).toBe(false);
      expect(qualitySignals(example, '').nonempty).toBe(false);
    },
  );

  it.each(QUALITY_CASES)(
    '$id: keeps the requested language, formulas and instructions through one call',
    async (example) => {
      vi.mocked(requestChat).mockResolvedValue({
        text: example.good,
        model: 'test-model',
        provider: 'groq',
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        totalTokens: null,
        durationMs: 1,
        reasoningEffort: 'low',
      });
      const answer = await askLernoAi({ message: example.prompt, history: [] });
      expect(answer).toBe(example.good);
      expect(requestChat).toHaveBeenCalledTimes(1);
      const request = vi.mocked(requestChat).mock.calls[0]![0];
      expect(request.messages.at(-1)?.content).toBe(example.prompt);
      expect(Object.values(qualitySignals(example, answer)).every(Boolean)).toBe(true);
    },
  );

  it('does not confuse newton with an advanced formula or accept 15 as 15% of 240', () => {
    const mass = QUALITY_CASES.find((example) => example.id === 'mass-weight')!;
    expect(qualitySignals(mass, mass.good).schoolLevel).toBe(true);
    const percent = QUALITY_CASES.find((example) => example.id === 'percent')!;
    expect(qualitySignals(percent, '15').expectedConcepts).toBe(false);
  });

  it('flags extra questions, answer leaks, unwanted HTML and long answers', () => {
    const practice = QUALITY_CASES.find((example) => example.id === 'hard-mavo')!;
    expect(qualitySignals(practice, `${practice.good} Waarom?`).requestedQuestionCount).toBe(false);
    expect(qualitySignals(practice, `${practice.good} Antwoord: 60 N.`).noKnownError).toBe(false);
    expect(qualitySignals(practice, '<b>Vraag?</b>').noRawHtml).toBe(false);
    expect(qualitySignals(practice, 'woord '.repeat(101)).length).toBe(false);
  });
});

describe('specific curriculum context regression probes', () => {
  it.each(CURRICULUM_QUALITY_CASES)(
    '$id: context policy accepts the expected response and rejects guessing',
    (example) => {
      expect(Object.values(curriculumQualitySignals(example, example.good)).every(Boolean)).toBe(
        true,
      );
      expect(Object.values(curriculumQualitySignals(example, example.bad)).every(Boolean)).toBe(
        false,
      );

      const request = buildChatRequest(example.prompt, example.history ?? []);
      expect(request.messages.at(-1)?.content).toBe(example.prompt);
      expect(
        chatContextSource(
          example.prompt,
          request.messages.slice(1, -1).filter((message) => message.role !== 'system'),
        ),
      ).toBe(example.contextSource);
      if (example.contextSource === 'chat') {
        expect(request.messages[0]?.content).toContain(
          'Context source: student-provided chat material.',
        );
      } else {
        expect(request.messages[0]?.content).not.toContain('Context source:');
      }
      expect(request.messages[0]?.content).toContain(CURRICULUM_RULE);
      if (example.id === 'follow-up-after-material') {
        expect(request.messages.some((message) => message.content.includes('bloedsomloop'))).toBe(
          true,
        );
      }
    },
  );

  it('uses explicit set and card provenance without treating them as missing context', () => {
    const setMessages = taskMessages(
      'explain',
      'TASK: Leg deze Lerno-set uit.\\nSET: Biology\\nCONTENT:\\n1. Q: What is photosynthesis? | A: Plants use light.',
      'set',
    );
    expect(setMessages[0]?.content).toContain('Context source: supplied Lerno set.');
    expect(setMessages[1]?.content).toContain('What is photosynthesis?');

    const cardMessages = taskMessages(
      'card',
      'TASK: Leg deze kaart uit.\\nCARD 2: Q: Define osmosis. A: Water movement.',
      'card',
    );
    expect(cardMessages[0]?.content).toContain('Context source: supplied card only.');
    expect(cardMessages[1]?.content).toContain('Define osmosis.');

    const futureDocumentMessages = taskMessages('explain', 'DOCUMENT: supplied notes', 'document');
    expect(futureDocumentMessages[0]?.content).toContain(
      'Context source: student-provided document.',
    );
  });

  it('never treats assistant claims as student-provided curriculum content', () => {
    expect(
      chatContextSource('Help mij leren voor morgen.', [
        {
          role: 'assistant',
          content: 'Hoofdstuk 1 gaat over cellen, weefsels en organen.',
        },
      ]),
    ).toBe('none');
  });
});

describe('compact teaching policy', () => {
  it('retains student level on hard follow-ups, never the assistant’s proposed level', () => {
    const request = buildChatRequest('Geef een moeilijke vraag over gewicht.', [
      { role: 'user', content: 'Ik zit in mavo 3.' },
      { role: 'assistant', content: 'Gebruik vwo 6 en g = GM/R².' },
    ]);
    expect(request.messages[0]!.content).toContain('Level: mavo 3.');
    expect(request.messages[0]!.content).not.toContain('Level: vwo');
    expect(request.messages[0]!.content).not.toContain('GM/R');
    expect(request.messages[0]!.content).toContain('deepen only on explicit request');
    expect(
      buildChatRequest('Leg dit uit op havo 4', [{ role: 'user', content: 'mavo 3' }]).messages[0]!
        .content,
    ).not.toContain('Level: mavo');
  });

  it('instructs direct, level-safe teaching and preserves structured validation settings', () => {
    expect(STUDY_SYSTEM_PROMPT).toContain('Core idea first');
    expect(STUDY_SYSTEM_PROMPT).toContain('default one question');
    expect(STUDY_SYSTEM_PROMPT).toContain('Hint: next step, no answer');
    expect(STUDY_SYSTEM_PROMPT).toContain('formula, substitution, result with units');
    expect(STUDY_SYSTEM_PROMPT).toContain('requested language');
    for (const name of ['questions', 'quiz', 'cards', 'hint', 'evaluate'] as const) {
      expect(AI_TASKS[name].json).toBe(true);
      expect(AI_TASKS[name].parseAttempts).toBe(2);
    }
    expect(AI_TASKS.study.parseAttempts).toBe(1);
  });

  it('keeps prompt tokens compact without fixture facts in prompts', () => {
    const encoder = getEncoding('o200k_base');
    expect(encoder.encode(STUDY_SYSTEM_PROMPT).length).toBeLessThanOrEqual(210);
    expect(
      encoder.encode(`${STUDY_SYSTEM_PROMPT} Context source: student-provided chat material.`)
        .length,
    ).toBeLessThanOrEqual(220);
    for (const task of Object.values(AI_TASKS)) {
      expect(encoder.encode(task.system).length).toBeLessThan(270);
      expect(task.system).not.toMatch(/Lodewijk|GM\/R|chlorofyl/);
    }
  });
});

describe('conservative prose cleanup', () => {
  it('removes same-line filler, not school content, language or markdown', () => {
    expect(cleanAiText('Natuurlijk! 15% van 240 = 36.')).toBe('15% van 240 = 36.');
    expect(cleanAiText('Sure!\nI go to school every day.')).toBe('I go to school every day.');
    const text = '## Gebeurtenissen\n* Lodewijk XVI\n- 1789\n\nF = m × g';
    expect(cleanAiText(text)).toBe(text);
    expect(cleanAiText('```text\nNatuurlijk!\n```')).toBe('```text\nNatuurlijk!\n```');
  });
});
