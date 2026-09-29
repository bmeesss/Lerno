/**
 * Content generation from the normalized source representation.
 *
 * One analysis, many products — the same concepts and text produce:
 *   summary · concepts · flashcards · practice questions (and, from the same
 *   stored question bank, tests)
 *
 * Everything a student can see passes three gates:
 *   1. the structured AI answer is schema-validated (`ai-schemas`),
 *   2. every provenance marker is resolved to a real reference (or dropped),
 *   3. `content-quality` rejects empty, duplicate, too long, unanswerable or
 *      concept-less items.
 *
 * Nothing is stored here: the caller (pipeline or preview) decides what to keep,
 * so AI can never overwrite approved content by itself.
 */
import type { ConceptRecord, QuestionType } from '../lib/db/types.js';
import {
  GENERATION_LANGUAGES,
  resolveGenerationLanguage,
  type GenerationLanguage,
  type MaterialDifficulty,
  type PackAnalysis,
} from '../lib/source-model.js';
import {
  generatedCardsSchema,
  generatedConceptsSchema,
  sourcePracticeSchema,
  generatedSummarySchema,
} from '../lib/ai-schemas.js';
import { runStructuredAiTask } from './ai-tasks.js';
import { matchConcept } from './study-pack-rules.js';
import {
  reviewConcepts,
  reviewFlashcards,
  reviewPracticeQuestions,
  reviewSummary,
  type FlashcardCandidate,
  type PracticeQuestionCandidate,
  type RejectedItem,
} from './content-quality.js';
import { buildSourceContext, type NormalizedSource } from './source-normalize.js';
import { resolveItemSource } from './source-analysis.js';

export const GENERATION_TARGETS = ['summary', 'concepts', 'flashcards', 'practice'] as const;
export type GenerationTarget = (typeof GENERATION_TARGETS)[number];

/** Simple, student-facing generation settings (never a settings maze). */
export interface GenerationSettings {
  flashcards: number;
  practice: number;
  difficulty: MaterialDifficulty;
  language: GenerationLanguage;
}

export const FLASHCARD_COUNT_OPTIONS = [10, 20, 30] as const;
export const PRACTICE_COUNT_OPTIONS = [10, 20, 30] as const;
export const DEFAULT_GENERATION_SETTINGS: Omit<GenerationSettings, 'language'> = {
  flashcards: 10,
  practice: 10,
  difficulty: 'medium',
};

/** Clamps student choices to what the generator can actually deliver. */
export function normalizeGenerationSettings(
  input: Partial<GenerationSettings> | null | undefined,
  materialLanguages: Parameters<typeof resolveGenerationLanguage>[1],
): GenerationSettings {
  const wanted = input ?? {};
  const flashcards = [10, 20, 30].includes(Number(wanted.flashcards))
    ? Number(wanted.flashcards)
    : DEFAULT_GENERATION_SETTINGS.flashcards;
  const practice = [10, 20, 30].includes(Number(wanted.practice))
    ? Number(wanted.practice)
    : DEFAULT_GENERATION_SETTINGS.practice;
  const difficulty: MaterialDifficulty = ['easy', 'medium', 'hard'].includes(
    String(wanted.difficulty),
  )
    ? (wanted.difficulty as MaterialDifficulty)
    : DEFAULT_GENERATION_SETTINGS.difficulty;
  const language = GENERATION_LANGUAGES.includes(wanted.language as GenerationLanguage)
    ? (wanted.language as GenerationLanguage)
    : resolveGenerationLanguage(null, materialLanguages);
  return { flashcards, practice, difficulty, language };
}

/** Header block that numbers the pack's concepts so the model can point at them. */
/**
 * The concepts the model may point at. Concepts generated earlier in this same
 * call are included too: a flashcard is normally written right after the concept
 * it belongs to, and dropping those links would lose the explanation.
 */
function conceptBlock(concepts: { name: string }[]): string {
  if (concepts.length === 0) return 'CONCEPTS (numbered, use conceptRef): none yet.';
  return [
    'CONCEPTS (numbered, use the number in conceptRef):',
    ...concepts
      .slice(0, 40)
      .map((concept, index) => `${index + 1}. ${concept.name}`),
  ].join('\n');
}

export interface ExistingContent {
  cardFronts: string[];
  questionPrompts: string[];
  conceptNames: string[];
}

export interface GeneratedSummary {
  title: string;
  summary: string;
  keyPoints: string[];
  keyFacts: string[];
  sourceId: string | null;
  refLabel: string | null;
}

export interface GeneratedConceptItem {
  name: string;
  explanation: string;
  sourceId: string;
  refLabel: string | null;
  importance: number | null;
  difficulty: MaterialDifficulty | null;
}

export type GeneratedFlashcard = FlashcardCandidate;

export type GeneratedQuestion = PracticeQuestionCandidate;

export interface GenerationBundle {
  summary: GeneratedSummary | null;
  concepts: GeneratedConceptItem[];
  flashcards: GeneratedFlashcard[];
  questions: GeneratedQuestion[];
  rejected: RejectedItem[];
}

export interface GenerateContentInput {
  sources: NormalizedSource[];
  concepts: ConceptRecord[];
  settings: GenerationSettings;
  existing?: ExistingContent;
  targets: GenerationTarget[];
  analysis?: PackAnalysis | null;
  maxContextChars?: number;
}

function conceptForRef<T>(ref: number | null | undefined, concepts: T[]): T | null {
  if (!ref || ref < 1 || ref > concepts.length) return null;
  return concepts[ref - 1] ?? null;
}

/** Generates the requested targets against the normalized sources. */
export async function generateContent(
  input: GenerateContentInput,
): Promise<GenerationBundle> {
  const { sources, settings } = input;
  const targets = new Set(input.targets);
  const existing: ExistingContent = input.existing ?? {
    cardFronts: [],
    questionPrompts: [],
    conceptNames: [],
  };

  const context = buildSourceContext(sources, {
    maxChars: input.maxContextChars ?? 16_000,
  });
  const usedSourceIds = context.usedSourceIds;
  /** Existing concepts first, then the concepts this call generates. */
  const knownConcepts: { id: string | null; name: string; explanation: string }[] = [
    ...input.concepts.map((concept) => ({
      id: concept.id,
      name: concept.name,
      explanation: concept.explanation,
    })),
  ];
  const conceptList = conceptBlock(knownConcepts);

  const rejected: RejectedItem[] = [];
  let summary: GeneratedSummary | null = null;
  let concepts: GeneratedConceptItem[] = [];
  let flashcards: GeneratedFlashcard[] = [];
  let questions: GeneratedQuestion[] = [];

  const requestBase = {
    language: settings.language,
    difficulty: settings.difficulty,
    analysis: input.analysis
      ? {
          summary: input.analysis.summary,
          examTopics: input.analysis.examTopics,
          difficulty: input.analysis.difficulty,
        }
      : null,
  };

  if (targets.has('summary')) {
    const { data } = await runStructuredAiTask({
      task: 'source-summary',
      payload: JSON.stringify({
        material: context.text,
        request: { ...requestBase, task: 'summary' },
      }),
      schema: generatedSummarySchema,
      contextSource: 'source',
      logMeta: { language: settings.language, sources: usedSourceIds.length },
    });
    const reviewed = reviewSummary(data.summary);
    rejected.push(...reviewed.rejected);
    if (reviewed.accepted[0]) {
      summary = {
        title: data.title,
        summary: reviewed.accepted[0].summary,
        keyPoints: data.keyPoints,
        keyFacts: [],
        sourceId: usedSourceIds.length === 1 ? usedSourceIds[0]! : null,
        refLabel: null,
      };
    }
  }

  if (targets.has('concepts')) {
    const { data } = await runStructuredAiTask({
      task: 'source-concepts',
      payload: JSON.stringify({
        material: context.text,
        request: { ...requestBase, task: 'concepts', count: 20 },
      }),
      schema: generatedConceptsSchema,
      contextSource: 'source',
      logMeta: { language: settings.language },
    });
    const candidates = data.concepts
      .map((concept) => {
        const resolved = resolveItemSource(context, concept.ref, usedSourceIds);
        return {
          name: concept.name,
          explanation: concept.explanation,
          refLabel: resolved.refLabel,
          sourceId: resolved.sourceId,
          importance: concept.importance ?? null,
          difficulty: (concept.difficulty as MaterialDifficulty | undefined) ?? null,
        };
      })
      .filter((concept) => concept.sourceId !== null);
    const review = reviewConcepts(
      candidates.map((concept) => ({
        name: concept.name,
        explanation: concept.explanation,
        refLabel: concept.refLabel,
        sourceId: concept.sourceId,
      })),
      { names: existing.conceptNames },
    );
    knownConcepts.push(
      ...review.accepted.map((concept) => ({
        id: null,
        name: concept.name,
        explanation: concept.explanation,
      })),
    );
    rejected.push(...review.rejected);
    concepts = review.accepted.map((concept) => {
      const original = candidates.find((entry) => entry.name === concept.name)!;
      return {
        name: concept.name,
        explanation: concept.explanation,
        sourceId: concept.sourceId!,
        refLabel: concept.refLabel,
        importance: original.importance,
        difficulty: original.difficulty,
      };
    });
  }

  if (targets.has('flashcards')) {
    const { data } = await runStructuredAiTask({
      task: 'source-flashcards',
      payload: JSON.stringify({
        material: context.text,
        concepts: conceptList,
        request: { ...requestBase, task: 'flashcards', count: settings.flashcards },
      }),
      schema: generatedCardsSchema,
      contextSource: 'source',
      maxOutputTokens: Math.min(3_800, 400 + settings.flashcards * 110),
      validCount: (value) => value.cards.length > 0,
      logMeta: { language: settings.language, requested: settings.flashcards },
    });
    const candidates: FlashcardCandidate[] = data.cards.map((card) => {
      const resolved = resolveItemSource(context, card.ref, usedSourceIds);
      const concept =
        conceptForRef(card.conceptRef, knownConcepts) ??
        matchConcept(`${card.front} ${card.back}`, knownConcepts);
      return {
        front: card.front,
        back: card.back,
        refLabel: resolved.refLabel,
        sourceId: resolved.sourceId,
        conceptId: concept?.id ?? null,
      };
    });
    const review = reviewFlashcards(candidates, { fronts: existing.cardFronts });
    rejected.push(...review.rejected);
    flashcards = review.accepted;
  }

  if (targets.has('practice')) {
    const { data } = await runStructuredAiTask({
      task: 'source-practice',
      payload: JSON.stringify({
        material: context.text,
        concepts: conceptList,
        request: {
          ...requestBase,
          task: 'practice',
          count: settings.practice,
          types: ['multiple_choice', 'true_false', 'open'],
        },
      }),
      schema: sourcePracticeSchema,
      contextSource: 'source',
      maxOutputTokens: Math.min(3_400, 400 + settings.practice * 180),
      validCount: (value) => value.questions.length > 0,
      logMeta: { language: settings.language, requested: settings.practice },
    });
    const candidates: PracticeQuestionCandidate[] = data.questions.map((question) => {
      const resolved = resolveItemSource(context, question.ref, usedSourceIds);
      const options = question.options.map((option) => option.trim()).filter(Boolean);
      const answer =
        question.type === 'multiple_choice' && question.correctIndex !== null
          ? (options[question.correctIndex] ?? question.answer)
          : question.answer;
      const concept =
        conceptForRef(question.conceptRef, knownConcepts) ??
        matchConcept(`${question.question} ${answer}`, knownConcepts);
      const questionType: QuestionType =
        question.type === 'multiple_choice'
          ? 'multiple_choice'
          : question.type === 'true_false'
            ? 'true_false'
            : 'short_answer';
      return {
        questionType,
        prompt: question.question,
        correctAnswer:
          questionType === 'true_false'
            ? answer.toLowerCase().startsWith('f') || answer.toLowerCase().startsWith('o')
              ? 'False'
              : 'True'
            : answer,
        options: questionType === 'short_answer' ? null : options,
        explanation: question.explanation,
        refLabel: resolved.refLabel,
        sourceId: resolved.sourceId,
        conceptId: concept?.id ?? null,
        // A concept from this same run has no id yet, but the question is linked.
        conceptName: concept && concept.id === null ? concept.name : null,
      };
    });
    const review = reviewPracticeQuestions(candidates, { prompts: existing.questionPrompts });
    rejected.push(...review.rejected);
    questions = review.accepted;
  }

  return { summary, concepts, flashcards, questions, rejected };
}

/** Why an item failed, in one line, for the "regenerate" flow. */
export function describeQualityFailure(rejected: RejectedItem[]): string {
  if (rejected.length === 0) return 'The new content could not be used.';
  return rejected[0]!.detail;
}
