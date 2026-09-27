/**
 * MCP tool input schemas (Phase 7 read + Phase 8A write + Phase 8B delete +
 * Master Build learning actions).
 *
 * Strict zod objects shared by the tool handlers. Identity never comes from
 * these schemas — the user id always comes from the auth context.
 *
 * Write tools reuse the canonical REST validators as the single source of
 * truth: the MCP input objects below share the REST field schemas by
 * reference (no copied length limits), and each handler re-parses with the
 * canonical validator so normalization (trimming, defaults, subject aliases)
 * is identical to the REST API. Delete tools likewise re-parse their ids
 * with the canonical REST param validators.
 */
import { z } from 'zod';
import { errors } from '../lib/errors.js';
import {
  bulkCardsSchema,
  cardContentSchema,
  cardParamsSchema,
  createSetSchema,
  setParamsSchema,
  updateCardSchema,
  updateSetSchema,
} from '../validators/set.validators.js';

/** No arguments (tools that operate on the authenticated user). */
export const emptyInputSchema = z.object({});

/** Tools scoped to one study set. Ownership/public access is enforced server-side. */
export const setIdInputSchema = z.object({
  setId: z
    .string()
    .uuid('Invalid set id')
    .describe('UUID of the study set (must be owned by you or public)'),
});

export type SetIdInput = z.infer<typeof setIdInputSchema>;

/**
 * Unwraps .transform()/.refine() layers to the underlying object so MCP tool
 * discovery can share the exact REST field schemas (same limits, messages).
 */
function baseObject(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> {
  let current: z.ZodTypeAny = schema;
  while (current instanceof z.ZodEffects) {
    current = current.innerType() as z.ZodTypeAny;
  }
  if (!(current instanceof z.ZodObject)) {
    throw new Error('MCP input schemas must be based on zod objects');
  }
  return current;
}

const setIdField = setIdInputSchema.shape.setId;

/** Shared card-content rules (question ≤2000, answer ≤4000, non-empty). */
export { cardContentSchema };

/** Canonical REST validators, re-applied inside write-tool handlers. */
export const canonicalValidators = {
  createSetSchema,
  bulkCardsSchema,
  updateSetSchema,
  updateCardSchema,
  setParamsSchema,
  cardParamsSchema,
};

/** lerno_create_set: same fields as POST /api/sets (visibility defaults to private). */
export const createSetInputSchema = z.object({ ...baseObject(createSetSchema).shape });
export type CreateSetInput = z.infer<typeof createSetInputSchema>;

/** lerno_add_cards: setId (from URL in REST) + bulk cards (1–500). */
export const addCardsInputSchema = z.object({
  setId: setIdField.describe('UUID of your own study set to add cards to'),
  cards: z
    .array(cardContentSchema)
    .min(1)
    .max(500)
    .describe('One or more flashcards to append (set stays capped at 500 cards total)'),
});
export type AddCardsInput = z.infer<typeof addCardsInputSchema>;

/** lerno_update_set: setId + the PATCH /api/sets/:setId fields (all optional). */
export const updateSetInputSchema = z.object({
  setId: setIdField.describe('UUID of your own study set to update'),
  ...baseObject(updateSetSchema).shape,
});
export type UpdateSetInput = z.infer<typeof updateSetInputSchema>;

/** lerno_update_cards: setId + per-card patches (question and/or answer each). */
export const updateCardsInputSchema = z.object({
  setId: setIdField.describe('UUID of your own study set containing the cards'),
  cards: z
    .array(
      z.object({
        cardId: z.string().uuid('Invalid card id').describe('UUID of the card to update'),
        // Same limits as creation; the canonical update validator additionally
        // requires at least one of the two per card.
        question: cardContentSchema.shape.question.optional(),
        answer: cardContentSchema.shape.answer.optional(),
      }),
    )
    .min(1)
    .max(500)
    .describe('Card updates; each entry must change the question, the answer, or both'),
});
export type UpdateCardsInput = z.infer<typeof updateCardsInputSchema>;

/**
 * Rejects exact-duplicate cards within one batch (same normalized
 * question+answer twice). Lerno itself has no duplicate-card policy, so this
 * is purely MCP input validation: it never touches existing cards and the
 * whole batch is rejected before anything is written (atomic batches).
 */
export function assertNoDuplicateCards(cards: { question: string; answer: string }[]): void {
  const seen = new Set<string>();
  for (const card of cards) {
    const key = `${card.question.trim().toLowerCase()}\n${card.answer.trim().toLowerCase()}`;
    if (seen.has(key)) {
      throw errors.validation('Duplicate card in batch: same question and answer twice');
    }
    seen.add(key);
  }
}

/** Rejects ambiguous batches that update the same card twice. */
export function assertNoDuplicateIds(cards: { cardId: string }[]): void {
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.cardId)) {
      throw errors.validation('Duplicate card in batch: same cardId updated twice');
    }
    seen.add(card.cardId);
  }
}

/**
 * Phase 8B: explicit confirmation for destructive tools.
 *
 * The confirmation is the exact literal "DELETE" (case-sensitive). This
 * mirrors the existing Lerno UX — a simple confirm dialog, not typing the
 * resource title — and is uniform for sets and cards. A generic
 * `confirmation: true` is deliberately NOT accepted: confirmation must be an
 * explicit per-call string, and each tool call names exactly one resource, so
 * one confirmation can never delete anything but that resource.
 */
export const DELETE_CONFIRMATION = 'DELETE' as const;

const confirmationField = z
  .literal(DELETE_CONFIRMATION, {
    errorMap: (issue) => {
      // z.literal reports invalid_literal even when the key is absent, so the
      // required-vs-mismatch split keys on the received value, not the code.
      if ((issue as { received?: unknown }).received === undefined) {
        return {
          message:
            'confirmation is required: pass confirmation "DELETE" to permanently delete this resource',
        };
      }
      return {
        message:
          'Confirmation mismatch: pass confirmation "DELETE" to permanently delete this resource',
      };
    },
  })
  .describe('Type DELETE (exactly, capitals) to confirm this permanent deletion');

/** Defense-in-depth: the handler re-checks what the input schema enforces. */
export function assertDeleteConfirmation(value: string): void {
  if (value !== DELETE_CONFIRMATION) {
    throw errors.validation(
      'Confirmation mismatch: pass confirmation "DELETE" to permanently delete this resource',
    );
  }
}

/** lerno_delete_set: setId (from URL in REST) + explicit confirmation. */
export const deleteSetInputSchema = z.object({
  setId: setIdField.describe('UUID of your own study set to permanently delete'),
  confirmation: confirmationField,
});
export type DeleteSetInput = z.infer<typeof deleteSetInputSchema>;

/** lerno_delete_card: setId + cardId (from URL in REST) + explicit confirmation. */
export const deleteCardInputSchema = z.object({
  setId: setIdField.describe('UUID of your own study set containing the card'),
  cardId: z.string().uuid('Invalid card id').describe('UUID of the card to permanently delete'),
  confirmation: confirmationField,
});
export type DeleteCardInput = z.infer<typeof deleteCardInputSchema>;

/** lerno_start_practice: study queue for one set, optionally shortened. */
export const startPracticeInputSchema = z.object({
  setId: setIdField.describe('UUID of a set you may study (your own or public)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe('Practice at most this many cards (default: the whole queue, like the website)'),
});
export type StartPracticeInput = z.infer<typeof startPracticeInputSchema>;

/** lerno_get_wrong_cards: recently failed cards, optionally scoped to one set. */
export const wrongCardsInputSchema = z.object({
  setId: setIdField.optional().describe('Only cards from this set (your own or public)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('At most this many cards, most recently reviewed first (default 20)'),
});
export type WrongCardsInput = z.infer<typeof wrongCardsInputSchema>;

/** lerno_create_study_plan: day-by-day suggestions derived from Lerno data. */
export const studyPlanInputSchema = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe('Plan window in days (default 7)'),
  setIds: z
    .array(z.string().uuid('Invalid set id'))
    .max(50)
    .optional()
    .describe('Only plan for these sets (default: your sets plus favorites)'),
});
export type StudyPlanInput = z.infer<typeof studyPlanInputSchema>;
