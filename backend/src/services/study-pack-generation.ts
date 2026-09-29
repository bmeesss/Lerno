/**
 * Generation layer for Study Packs: turns an authorized pack into AI previews,
 * and answers tutor questions strictly from the pack's own material.
 *
 * Nothing here writes to the database — previews go back to the student, who
 * can edit them and confirm through `POST /study-packs/:id/content`.
 */
import type { Database } from '../lib/db/repository.js';
import type { PracticeQuestionRecord } from '../lib/db/types.js';
import { errors } from '../lib/errors.js';
import type { PackAnalysis } from '../lib/source-model.js';
import type { RejectedItem } from './content-quality.js';
import { toNormalizedSource } from './source-normalize.js';
import {
  describeQualityFailure,
  generateContent,
  normalizeGenerationSettings,
  type GeneratedConceptItem,
  type GeneratedFlashcard,
  type GeneratedQuestion,
  type GenerationSettings,
} from './source-generation.js';
import { loadPackAiInput } from './study-pack-service.js';
import { tutorService } from './tutor-context.js';
import {
  generatePackConcepts,
  generatePackFlashcards,
  generatePackPractice,
  generatePackSummary,
  isReadableSource,
  type PackAiInput,
} from './study-pack-ai.js';
import type { GenerateBody, TutorBody } from '../validators/study-pack.validators.js';

/** The pack must contain readable material before any generation can happen. */
function requireUsableSource(input: PackAiInput): void {
  const ready = input.sources.filter((source) => isReadableSource(source, 20));
  if (ready.length === 0) {
    throw errors.validation('Add a source with readable text before generating study material.');
  }
}

async function resolveInput(db: Database, userId: string, packId: string): Promise<PackAiInput> {
  const input = await loadPackAiInput(db, userId, packId);
  return input;
}

/** Everything the student confirms in the review screen, in one response. */
export interface StudyContentPreview {
  packId: string;
  settings: GenerationSettings;
  summary: { title: string; summary: string; keyPoints: string[]; sourceId: string | null } | null;
  concepts: GeneratedConceptItem[];
  flashcards: GeneratedFlashcard[];
  questions: GeneratedQuestion[];
  /** Items the quality pass rejected (never shown as content, only explained). */
  rejected: RejectedItem[];
  analysis: PackAnalysis | null;
  conflicts: PackAnalysis['conflicts'];
}

export type RegeneratableKind = 'flashcard' | 'question' | 'concept';

export interface RegenerationRequest {
  kind: RegeneratableKind;
  /** The item being replaced — it is excluded from duplicate detection. */
  current: Record<string, unknown>;
  sourceId?: string | null;
  settings?: Partial<GenerationSettings> | null;
}

export const studyPackGenerationService = {
  /** Generates an editable preview for one target. Nothing is stored here. */
  async generate(db: Database, userId: string, packId: string, body: GenerateBody) {
    const input = await resolveInput(db, userId, packId);
    requireUsableSource(input);
    if (body.sourceId && !input.sources.some((source) => source.id === body.sourceId)) {
      throw errors.notFound('Source not found');
    }
    const options = { sourceId: body.sourceId ?? undefined, count: body.count };

    switch (body.target) {
      case 'summary':
        return { target: body.target, ...(await generatePackSummary(input, options)) };
      case 'concepts':
        return { target: body.target, ...(await generatePackConcepts(input, options)) };
      case 'flashcards':
        return { target: body.target, ...(await generatePackFlashcards(input, options)) };
      case 'practice': {
        const preview = await generatePackPractice(input, options);
        return {
          target: body.target,
          questions: preview.questions.map((question) => ({
            ...question,
            questionType: question.questionType,
          })),
        };
      }
    }
  },

  /**
   * Generates the full review bundle from the pack's normalized sources and its
   * stored analysis: summary, concepts, flashcards and practice questions, all
   * quality-checked and with verified provenance. Nothing is stored here.
   */
  async previewStudyContent(
    db: Database,
    userId: string,
    packId: string,
    body: { sourceId?: string | null; settings?: Partial<GenerationSettings> | null } = {},
  ): Promise<StudyContentPreview> {
    const pack = await db.packs.get(packId);
    if (!pack || pack.ownerId !== userId) throw errors.notFound('Study pack not found');
    const sources = await db.packSources.listByPack(packId);
    const readable = sources
      .filter((source) => source.status !== 'failed' && (source.content ?? '').trim().length > 0)
      .filter((source) => (body.sourceId ? source.id === body.sourceId : true))
      .map(toNormalizedSource);
    if (readable.length === 0) {
      throw errors.validation('Add a source with readable text before generating study material.');
    }

    const concepts = await db.concepts.listByPack(packId);
    const set = pack.legacySetId ? await db.sets.get(pack.legacySetId) : null;
    const cards = set ? await db.cards.listBySet(set.id) : [];
    const questions = await db.practiceQuestions.listByPack(packId);
    const settings = normalizeGenerationSettings(
      body.settings,
      readable.map((source) => source.language),
    );

    const bundle = await generateContent({
      sources: readable,
      concepts,
      settings,
      existing: {
        cardFronts: cards.map((card) => card.question),
        questionPrompts: questions.map((question) => question.prompt),
        conceptNames: concepts.map((concept) => concept.name),
      },
      targets: ['summary', 'concepts', 'flashcards', 'practice'],
      analysis: pack.analysis,
    });

    return {
      packId,
      settings,
      summary: bundle.summary
        ? {
            title: bundle.summary.title,
            summary: bundle.summary.summary,
            keyPoints: bundle.summary.keyPoints,
            sourceId: bundle.summary.sourceId,
          }
        : null,
      concepts: bundle.concepts,
      flashcards: bundle.flashcards,
      questions: bundle.questions,
      rejected: bundle.rejected,
      analysis: pack.analysis,
      conflicts: pack.analysis?.conflicts ?? [],
    };
  },

  /**
   * Regenerates exactly one item. The replacement goes through the same quality
   * pass as the first generation; when it fails, the student gets an honest
   * error instead of a broken item. Approved content is never touched.
   */
  async regenerateItem(
    db: Database,
    userId: string,
    packId: string,
    input: RegenerationRequest,
  ): Promise<
    | { kind: 'flashcard'; item: GeneratedFlashcard }
    | { kind: 'question'; item: GeneratedQuestion }
    | { kind: 'concept'; item: GeneratedConceptItem }
  > {
    const pack = await db.packs.get(packId);
    if (!pack || pack.ownerId !== userId) throw errors.notFound('Study pack not found');
    const sources = (await db.packSources.listByPack(packId))
      .filter((source) => source.status !== 'failed' && (source.content ?? '').trim().length > 0)
      .map(toNormalizedSource);
    if (sources.length === 0) {
      throw errors.validation('Add a source with readable text before generating study material.');
    }
    const concepts = await db.concepts.listByPack(packId);
    const set = pack.legacySetId ? await db.sets.get(pack.legacySetId) : null;
    const cards = set ? await db.cards.listBySet(set.id) : [];
    const questions = await db.practiceQuestions.listByPack(packId);
    const settings = normalizeGenerationSettings(input.settings, sources.map((s) => s.language));
    const currentFront = typeof input.current.front === 'string' ? input.current.front : '';
    const currentPrompt = typeof input.current.prompt === 'string' ? input.current.prompt : '';
    const currentName = typeof input.current.name === 'string' ? input.current.name : '';

    const bundle = await generateContent({
      sources,
      concepts,
      settings,
      existing: {
        // The item being replaced must not block its own replacement.
        cardFronts: cards.map((card) => card.question).filter((front) => front !== currentFront),
        questionPrompts: questions
          .map((question) => question.prompt)
          .filter((prompt) => prompt !== currentPrompt),
        conceptNames: concepts.map((concept) => concept.name).filter((name) => name !== currentName),
      },
      targets: [input.kind === 'concept' ? 'concepts' : input.kind === 'flashcard' ? 'flashcards' : 'practice'],
      analysis: pack.analysis,
    });

    if (input.kind === 'flashcard') {
      const item = bundle.flashcards[0];
      if (!item) throw errors.aiInvalidContent(describeQualityFailure(bundle.rejected));
      return { kind: 'flashcard', item };
    }
    if (input.kind === 'question') {
      const item = bundle.questions[0];
      if (!item) throw errors.aiInvalidContent(describeQualityFailure(bundle.rejected));
      return { kind: 'question', item };
    }
    const item = bundle.concepts[0];
    if (!item) throw errors.aiInvalidContent(describeQualityFailure(bundle.rejected));
    return { kind: 'concept', item };
  },

  /** Pack-scoped tutor: grounded in this pack's sources only. */
  async tutor(db: Database, userId: string, packId: string, body: TutorBody) {
    const input = await resolveInput(db, userId, packId);
    requireUsableSource(input);
    return tutorService.reply(db, userId, input, body);
  },
};

export type { PracticeQuestionRecord };
