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
import { loadPackAiInput } from './study-pack-service.js';
import {
  chatWithPack,
  generatePackConcepts,
  generatePackFlashcards,
  generatePackPractice,
  generatePackSummary,
  type PackAiInput,
} from './study-pack-ai.js';
import type { GenerateBody, TutorBody } from '../validators/study-pack.validators.js';

/** The pack must contain readable material before any generation can happen. */
function requireUsableSource(input: PackAiInput): void {
  const ready = input.sources.filter(
    (source) => source.status === 'ready' && (source.content ?? '').trim().length >= 20,
  );
  if (ready.length === 0) {
    throw errors.validation('Add a source with readable text before generating study material.');
  }
}

async function resolveInput(db: Database, userId: string, packId: string): Promise<PackAiInput> {
  const input = await loadPackAiInput(db, userId, packId);
  return input;
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

  /** Pack-scoped tutor: grounded in this pack's sources only. */
  async tutor(db: Database, userId: string, packId: string, body: TutorBody) {
    const input = await resolveInput(db, userId, packId);
    requireUsableSource(input);
    return chatWithPack(input, body.message, body.history);
  },
};

export type { PracticeQuestionRecord };
