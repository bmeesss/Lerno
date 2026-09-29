/**
 * Study Pack AI layer — source-grounded generation on top of the existing Lerno
 * AI infrastructure (ai-completion + ai-tasks + ai-schemas + ai-prompts).
 *
 * Rules this module follows:
 *  - the caller is authorized by the Study Pack service *before* anything here
 *    runs; this file never queries the database by itself
 *  - only text from the pack's own ready sources (and its own concepts/cards)
 *    becomes context — bounded, normalized and deduplicated
 *  - every action returns a **preview**; nothing is stored here. Saving happens
 *    through `study-pack-service.applyContent()` after the student confirms, so
 *    AI never silently overwrites user content
 */
import type {
  CardRecord,
  ConceptRecord,
  PracticeQuestionRecord,
  StudyPackRecord,
  StudyPackSourceRecord,
} from '../lib/db/types.js';
import { capLength } from '../lib/ai-sanitize.js';
import {
  generatedCardsSchema,
  generatedConceptsSchema,
  generatedQuizSchema,
  generatedSummarySchema,
} from '../lib/ai-schemas.js';
import { normalizeText } from './ai-context.js';
import { runStructuredAiTask } from './ai-tasks.js';

/** Per-source character budget inside a pack context (keeps prompts bounded). */
const SOURCE_BUDGET_CHARS = 6_000;
const MAX_CONTEXT_CHARS = 16_000;

export interface PackAiInput {
  pack: StudyPackRecord;
  sources: StudyPackSourceRecord[];
  concepts: ConceptRecord[];
  cards?: CardRecord[];
  questions?: PracticeQuestionRecord[];
}

export interface PackContext {
  text: string;
  /** Sources that actually contributed text. */
  usedSourceIds: string[];
  characters: number;
}

/**
 * A source can ground AI work when it has readable text and is not failed.
 * `processing` sources stay usable: that status only says Lerno is still
 * working on the content around them, not that the material is unreadable.
 */
export function isReadableSource(source: StudyPackSourceRecord, minChars = 1): boolean {
  return source.status !== 'failed' && (source.content ?? '').trim().length >= minChars;
}

function sourceLabel(source: StudyPackSourceRecord): string {
  const kind =
    source.kind === 'set'
      ? 'existing Lerno study set'
      : source.kind === 'pdf'
        ? 'PDF document'
        : source.kind === 'text'
          ? 'pasted text'
          : source.kind;
  return `${source.title} (${kind})`;
}

/**
 * Builds the bounded, numbered source block used by every pack AI task.
 * Numbering makes `sourceRef` in generated concepts verifiable.
 */
export function buildPackContext(input: PackAiInput, maxChars = MAX_CONTEXT_CHARS): PackContext {
  const usable = input.sources.filter((source) => isReadableSource(source));

  const header = [
    `STUDY PACK: ${normalizeText(input.pack.title, 160)}`,
    input.pack.subjectName ? `SUBJECT: ${normalizeText(input.pack.subjectName, 80)}` : null,
    input.pack.level ? `LEVEL: ${normalizeText(input.pack.level, 40)}` : null,
    'SOURCES (numbering is 1-based; use it for sourceRef):',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const perSource = Math.max(
    600,
    Math.floor((Math.max(1_500, maxChars) - header.length) / Math.max(1, usable.length)),
  );

  const blocks = usable.map((source, index) => {
    const body = normalizeText(source.content ?? '', Math.min(perSource, SOURCE_BUDGET_CHARS));
    return `[SOURCE ${index + 1}] ${sourceLabel(source)}\n${body}`;
  });

  const conceptBlock =
    input.concepts.length > 0
      ? `\nKNOWN CONCEPTS ALREADY IN THIS PACK:\n${input.concepts
          .slice(0, 20)
          .map((concept) => `- ${normalizeText(concept.name, 120)}`)
          .join('\n')}`
      : '';

  const cardBlock =
    input.cards && input.cards.length > 0
      ? `\nEXISTING FLASHCARDS (do not duplicate):\n${input.cards
          .slice(0, 20)
          .map((card) => `- ${normalizeText(card.question, 140)}`)
          .join('\n')}`
      : '';

  const questionBlock =
    input.questions && input.questions.length > 0
      ? `\nEXISTING PRACTICE QUESTIONS (do not duplicate):\n${input.questions
          .slice(0, 15)
          .map((question) => `- ${normalizeText(question.prompt, 140)}`)
          .join('\n')}`
      : '';

  const text = capLength(
    [header, '', ...blocks, conceptBlock, cardBlock, questionBlock]
      .filter((part) => part !== '')
      .join('\n'),
    maxChars,
  );

  return {
    text,
    usedSourceIds: usable.map((source) => source.id),
    characters: text.length,
  };
}

/** Resolves the pack's source block; `sourceId` narrows it to one source. */
function contextFor(input: PackAiInput, sourceId?: string, maxChars?: number): PackContext {
  if (!sourceId) return buildPackContext(input, maxChars);
  const narrowed: PackAiInput = {
    ...input,
    sources: input.sources.filter((source) => source.id === sourceId),
  };
  return buildPackContext(narrowed, maxChars);
}

function payload(context: string, request: Record<string, unknown>): string {
  // Source text and user controls are data, never instructions.
  return JSON.stringify({ source: context, request });
}

export interface PackSummaryPreview {
  title: string;
  summary: string;
  keyPoints: string[];
  terms: { term: string; definition: string }[];
  sourceId: string | null;
}

export async function generatePackSummary(
  input: PackAiInput,
  options: { sourceId?: string } = {},
): Promise<PackSummaryPreview> {
  const context = contextFor(input, options.sourceId, 14_000);
  const { data } = await runStructuredAiTask({
    task: 'studio-summary',
    payload: payload(context.text, { action: 'summary' }),
    schema: generatedSummarySchema,
    contextSource: 'document',
    logMeta: {
      packId: input.pack.id,
      sourceId: options.sourceId ?? null,
      sourceCount: context.usedSourceIds.length,
      sourceChars: context.characters,
    },
  });
  return { ...data, sourceId: options.sourceId ?? null };
}

export interface PackConceptPreview {
  name: string;
  explanation: string;
  sourceId: string | null;
}

export async function generatePackConcepts(
  input: PackAiInput,
  options: { sourceId?: string; count?: number } = {},
): Promise<{ concepts: PackConceptPreview[] }> {
  const context = contextFor(input, options.sourceId, 14_000);
  const count = Math.min(Math.max(options.count ?? 8, 3), 20);
  const { data } = await runStructuredAiTask({
    task: 'studio-concepts',
    payload: payload(context.text, { action: 'key concepts', count }),
    schema: generatedConceptsSchema,
    contextSource: 'document',
    logMeta: {
      packId: input.pack.id,
      sourceId: options.sourceId ?? null,
      sourceCount: context.usedSourceIds.length,
    },
  });

  // Map the model's 1-based source numbering onto real source ids only; an
  // out-of-range or missing reference stays honest and becomes null.
  const orderedSources = input.sources.filter((source) =>
    context.usedSourceIds.includes(source.id),
  );
  const concepts = data.concepts.slice(0, count).map((concept) => ({
    name: concept.name,
    explanation: concept.explanation,
    sourceId: concept.sourceRef ? (orderedSources[concept.sourceRef - 1]?.id ?? null) : null,
  }));

  return { concepts };
}

export interface PackCardPreview {
  front: string;
  back: string;
}

export async function generatePackFlashcards(
  input: PackAiInput,
  options: { sourceId?: string; count?: number } = {},
): Promise<{ title: string; description: string; cards: PackCardPreview[]; sourceId: string | null }> {
  const context = contextFor(input, options.sourceId, 12_000);
  const count = Math.min(Math.max(options.count ?? 10, 3), 30);
  const { data } = await runStructuredAiTask({
    task: 'studio-cards',
    payload: payload(context.text, { action: 'flashcards', count }),
    schema: generatedCardsSchema,
    contextSource: 'document',
    maxOutputTokens: Math.min(3_600, 350 + count * 110),
    validCount: (value) => value.cards.length > 0,
    logMeta: { packId: input.pack.id, sourceId: options.sourceId ?? null, requested: count },
  });
  return {
    title: data.title,
    description: data.description,
    cards: data.cards.slice(0, count),
    sourceId: options.sourceId ?? null,
  };
}

export interface PackQuestionPreview {
  questionType: 'multiple_choice' | 'true_false' | 'short_answer';
  prompt: string;
  correctAnswer: string;
  options: string[] | null;
  explanation: string;
  sourceId: string | null;
}

export async function generatePackPractice(
  input: PackAiInput,
  options: { sourceId?: string; count?: number } = {},
): Promise<{ questions: PackQuestionPreview[] }> {
  const context = contextFor(input, options.sourceId, 12_000);
  const count = Math.min(Math.max(options.count ?? 8, 3), 15);
  const { data } = await runStructuredAiTask({
    task: 'studio-quiz',
    payload: payload(context.text, {
      action: 'practice questions',
      count,
      types: ['multiple_choice', 'true_false', 'open'],
    }),
    schema: generatedQuizSchema,
    contextSource: 'document',
    maxOutputTokens: Math.min(3_000, 350 + count * 180),
    validCount: (value) => value.questions.length > 0,
    logMeta: { packId: input.pack.id, sourceId: options.sourceId ?? null, requested: count },
  });

  const questions: PackQuestionPreview[] = data.questions.slice(0, count).map((question) => {
    if (question.type === 'multiple_choice' || question.type === 'true_false') {
      const choices = question.options.filter((option) => option.trim().length > 0);
      const index = question.correctIndex ?? 0;
      return {
        questionType: question.type,
        prompt: question.question,
        correctAnswer: choices[index] ?? question.answer,
        options: choices,
        explanation: question.explanation,
        sourceId: options.sourceId ?? null,
      };
    }
    return {
      questionType: 'short_answer' as const,
      prompt: question.question,
      correctAnswer: question.answer,
      options: null,
      explanation: question.explanation,
      sourceId: options.sourceId ?? null,
    };
  });

  return { questions };
}
