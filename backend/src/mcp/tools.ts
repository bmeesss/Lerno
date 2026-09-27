/**
 * Lerno MCP tools (Phase 7 read + Phase 8A write + Phase 8B delete + Master
 * Build learning actions).
 *
 * Every tool is a thin wrapper around an existing Lerno service — no business
 * logic is duplicated here. Streaks, goals, due cards, queues, ownership,
 * quiz generation, set/card mutation and deletion all run in the same
 * services as the REST API and the website. Handlers only validate input with
 * the canonical validators, call one service, and shape the output into
 * compact, model-friendly objects that never include secrets.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { Database } from '../lib/db/repository.js';
import { errors } from '../lib/errors.js';
import { profileService } from '../services/profile-service.js';
import { progressService } from '../services/progress-service.js';
import { quizService } from '../services/quiz-service.js';
import { resolveTimeZone, retentionService } from '../services/retention-service.js';
import { setService } from '../services/set-service.js';
import { studyService } from '../services/study-service.js';
import type { SetSummaryDto } from '../services/set-view.js';
import {
  addCardsInputSchema,
  assertDeleteConfirmation,
  assertNoDuplicateCards,
  assertNoDuplicateIds,
  canonicalValidators,
  createSetInputSchema,
  deleteCardInputSchema,
  deleteSetInputSchema,
  emptyInputSchema,
  setIdInputSchema,
  startPracticeInputSchema,
  studyPlanInputSchema,
  updateCardsInputSchema,
  updateSetInputSchema,
  wrongCardsInputSchema,
  type AddCardsInput,
  type CreateSetInput,
  type DeleteCardInput,
  type DeleteSetInput,
  type SetIdInput,
  type StartPracticeInput,
  type StudyPlanInput,
  type UpdateCardsInput,
  type UpdateSetInput,
  type WrongCardsInput,
} from './schemas.js';

/** Authenticated caller. `userId` comes exclusively from the auth context. */
export interface McpContext {
  userId: string;
  db: Database;
}

type EmptyInput = Record<string, never>;

/** Hints from the installed SDK's ToolAnnotations (no invented fields). */
const readAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const writeAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const destructiveAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

function setSummaryCompact(set: SetSummaryDto): Record<string, unknown> {
  return {
    id: set.id,
    title: set.title,
    subjectName: set.subjectName,
    visibility: set.visibility,
    cardCount: set.cardCount,
    createdAt: set.createdAt,
    updatedAt: set.updatedAt,
  };
}

export const mcpTools = {
  getProfile: {
    name: 'lerno_get_profile',
    description:
      'Get the authenticated student’s public-safe profile (id, display name, avatar, member since). ' +
      'Use it to personalize answers. Takes no arguments; identity comes from authentication. ' +
      'Does not return email addresses, passwords, tokens or settings, and cannot modify anything.',
    annotations: readAnnotations,
    inputSchema: emptyInputSchema,
    async run(ctx: McpContext, _args: EmptyInput): Promise<Record<string, unknown>> {
      const profile = await profileService.getOwn(ctx.db, ctx.userId);
      return {
        profile: {
          id: profile.id,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          createdAt: profile.createdAt,
        },
      };
    },
  },

  listSets: {
    name: 'lerno_list_sets',
    description:
      'List the authenticated student’s own study sets (id, title, subject, visibility, card count, timestamps). ' +
      'Use it to answer “which sets do I have?” or to pick a set for follow-up tools. ' +
      'Takes no arguments. Only the caller’s own sets are returned; other users’ private sets are never included.',
    annotations: readAnnotations,
    inputSchema: emptyInputSchema,
    async run(ctx: McpContext, _args: EmptyInput): Promise<Record<string, unknown>> {
      const sets = await setService.listMine(ctx.db, ctx.userId);
      return { count: sets.length, sets: sets.map(setSummaryCompact) };
    },
  },

  getSet: {
    name: 'lerno_get_set',
    description:
      'Get one study set’s metadata (title, subject, description, level, visibility, tags, card count, ownership, timestamps). ' +
      'The set must be owned by the caller or public; anything else returns NOT_FOUND. ' +
      'Does not return the set’s cards — use lerno_get_cards for those — and cannot modify anything.',
    annotations: readAnnotations,
    inputSchema: setIdInputSchema,
    async run(ctx: McpContext, args: SetIdInput): Promise<Record<string, unknown>> {
      const set = await setService.getDetail(ctx.db, ctx.userId, args.setId);
      return {
        set: {
          id: set.id,
          title: set.title,
          subjectName: set.subjectName,
          description: set.description,
          level: set.level,
          visibility: set.visibility,
          tags: set.tags,
          cardCount: set.cardCount,
          isOwner: set.isOwner,
          createdAt: set.createdAt,
          updatedAt: set.updatedAt,
        },
      };
    },
  },

  getCards: {
    name: 'lerno_get_cards',
    description:
      'Get the flashcards (question, answer, position) of one study set the caller may view. ' +
      'Use it to quiz the student conversationally or to explain their material. ' +
      'The set must be owned by the caller or public; anything else returns NOT_FOUND. Read-only.',
    annotations: readAnnotations,
    inputSchema: setIdInputSchema,
    async run(ctx: McpContext, args: SetIdInput): Promise<Record<string, unknown>> {
      const cards = await setService.listCards(ctx.db, ctx.userId, args.setId);
      return {
        setId: args.setId,
        count: cards.length,
        cards: cards.map((card) => ({
          id: card.id,
          question: card.question,
          answer: card.answer,
          position: card.position,
        })),
      };
    },
  },

  getProgress: {
    name: 'lerno_get_progress',
    description:
      'Get the authenticated student’s study progress: cards studied, accuracy, due cards, quiz attempts, ' +
      'study time, streaks and per-set/per-subject breakdowns. Same numbers as the website’s progress page. ' +
      'Takes no arguments; progress of other users is never visible. Read-only.',
    annotations: readAnnotations,
    inputSchema: emptyInputSchema,
    async run(ctx: McpContext, _args: EmptyInput): Promise<Record<string, unknown>> {
      const timeZone = await resolveTimeZone(ctx.db, ctx.userId);
      return progressService.stats(ctx.db, ctx.userId, new Date(), timeZone);
    },
  },

  getToday: {
    name: 'lerno_get_today',
    description:
      'Get today’s study summary: daily-goal progress, streak, due/upcoming reviews, comeback state and the ' +
      'recommended next action. Same data as the website’s Today panel. Use it to answer “how am I doing today?”. ' +
      'Takes no arguments. Read-only.',
    annotations: readAnnotations,
    inputSchema: emptyInputSchema,
    async run(ctx: McpContext, _args: EmptyInput): Promise<Record<string, unknown>> {
      // Explicit field list: same values as the website's Today panel, and a
      // stable MCP contract if the service type ever grows new fields.
      const today = await retentionService.today(
        ctx.db,
        ctx.userId,
        new Date(),
        await resolveTimeZone(ctx.db, ctx.userId),
      );
      return {
        date: today.date,
        target: today.target,
        completedCards: today.completedCards,
        completionPercentage: today.completionPercentage,
        goalReached: today.goalReached,
        cardsDue: today.cardsDue,
        upcoming: today.upcoming,
        streak: today.streak,
        comeback: today.comeback,
        continueAction: today.continueAction,
      };
    },
  },

  getDueReviews: {
    name: 'lerno_get_due_reviews',
    description:
      'Get the flashcards currently due for review, grouped by study set (set title, due count, oldest due time). ' +
      'Uses Lerno’s spaced-repetition schedule. Use it to answer “what should I review now?”. Takes no arguments. Read-only.',
    annotations: readAnnotations,
    inputSchema: emptyInputSchema,
    async run(ctx: McpContext, _args: EmptyInput): Promise<Record<string, unknown>> {
      const groups = await studyService.dueGroups(ctx.db, ctx.userId);
      return {
        totalDue: groups.reduce((sum, group) => sum + group.dueCount, 0),
        groups,
      };
    },
  },

  getNextAction: {
    name: 'lerno_get_next_action',
    description:
      'Get the single most relevant thing to study next (due reviews, unfinished session, unfinished set, ' +
      'daily-goal cards, or a nudge to create/discover sets). Same recommendation as the website dashboard. ' +
      'Use it to answer “what should I learn now?”. Takes no arguments. Read-only.',
    annotations: readAnnotations,
    inputSchema: emptyInputSchema,
    async run(ctx: McpContext, _args: EmptyInput): Promise<Record<string, unknown>> {
      const today = await retentionService.today(
        ctx.db,
        ctx.userId,
        new Date(),
        await resolveTimeZone(ctx.db, ctx.userId),
      );
      return { action: today.continueAction };
    },
  },

  getQuiz: {
    name: 'lerno_get_quiz',
    description:
      'Get the generated quiz (prompts, question types, options) for one study set the caller may view. ' +
      'Same questions as the website quiz; correct answers are intentionally not included. ' +
      'The set must be owned by the caller or public; anything else returns NOT_FOUND. ' +
      'Cannot submit answers or modify anything.',
    annotations: readAnnotations,
    inputSchema: setIdInputSchema,
    async run(ctx: McpContext, args: SetIdInput): Promise<Record<string, unknown>> {
      const quiz = await quizService.loadForSet(ctx.db, ctx.userId, args.setId);
      return { quiz };
    },
  },

  createSet: {
    name: 'lerno_create_set',
    description:
      'Create a new study set for the authenticated student, optionally with flashcards in one action. ' +
      'Use it when the student asks to make a set (e.g. “make a private set about photosynthesis with 20 cards”). ' +
      'New sets are private unless the student explicitly asks for a public set. ' +
      'At most 500 cards per set; batches with exact-duplicate cards are rejected. ' +
      'Identity comes from authentication; there is no way to create content for another user. ' +
      'Cannot delete or modify existing content.',
    annotations: writeAnnotations,
    inputSchema: createSetInputSchema,
    async run(ctx: McpContext, args: CreateSetInput): Promise<Record<string, unknown>> {
      const input = canonicalValidators.createSetSchema.parse(args);
      assertNoDuplicateCards(input.cards ?? []);
      const created = await setService.create(ctx.db, ctx.userId, input);
      return {
        created: true,
        set: {
          id: created.id,
          title: created.title,
          visibility: created.visibility,
          cardCount: created.cardCount,
        },
      };
    },
  },

  addCards: {
    name: 'lerno_add_cards',
    description:
      'Append one or more flashcards to one of the authenticated student’s own sets. ' +
      'Only the set owner can add cards; other users’ sets (even public ones) stay read-only here. ' +
      'A set holds at most 500 cards; batches that would exceed the cap, or contain exact-duplicate cards, ' +
      'are rejected without writing anything. Cannot modify or delete existing cards.',
    annotations: writeAnnotations,
    inputSchema: addCardsInputSchema,
    async run(ctx: McpContext, args: AddCardsInput): Promise<Record<string, unknown>> {
      const batch = canonicalValidators.bulkCardsSchema.parse({ cards: args.cards });
      assertNoDuplicateCards(batch.cards);
      const created = await setService.addCards(ctx.db, ctx.userId, args.setId, batch.cards);
      const total = await setService.listCards(ctx.db, ctx.userId, args.setId);
      return { created: created.length, setId: args.setId, totalCards: total.length };
    },
  },

  updateSet: {
    name: 'lerno_update_set',
    description:
      'Update title, description, level, subject, visibility or tags of one of the authenticated student’s own sets. ' +
      'Only the owner can update; omit fields to leave them unchanged. ' +
      'Cannot change ownership, transfer sets, or modify/delete cards.',
    annotations: writeAnnotations,
    inputSchema: updateSetInputSchema,
    async run(ctx: McpContext, args: UpdateSetInput): Promise<Record<string, unknown>> {
      const { setId, ...patch } = args;
      const body = canonicalValidators.updateSetSchema.parse(patch);
      const updated = await setService.update(ctx.db, ctx.userId, setId, body);
      return {
        updated: true,
        set: {
          id: updated.id,
          title: updated.title,
          description: updated.description,
          visibility: updated.visibility,
          cardCount: updated.cardCount,
        },
      };
    },
  },

  updateCards: {
    name: 'lerno_update_cards',
    description:
      'Edit the question and/or answer of one or more cards in one of the authenticated student’s own sets. ' +
      'Each entry needs the card id plus a new question, a new answer, or both. ' +
      'Every entry is validated and checked against the set before anything is written, so a bad batch changes nothing. ' +
      'Cannot add, delete or move cards.',
    annotations: writeAnnotations,
    inputSchema: updateCardsInputSchema,
    async run(ctx: McpContext, args: UpdateCardsInput): Promise<Record<string, unknown>> {
      const patches = args.cards.map((card) => ({
        cardId: card.cardId,
        patch: canonicalValidators.updateCardSchema.parse({
          question: card.question,
          answer: card.answer,
        }),
      }));
      assertNoDuplicateIds(args.cards);
      // Membership pre-check so a bad batch fails before the first write; the
      // service re-checks per card and stays authoritative.
      const existing = await setService.listCards(ctx.db, ctx.userId, args.setId);
      const known = new Set(existing.map((card) => card.id));
      for (const card of args.cards) {
        if (!known.has(card.cardId)) throw errors.notFound('Card not found');
      }
      for (const { cardId, patch } of patches) {
        await setService.updateCard(ctx.db, ctx.userId, args.setId, cardId, patch);
      }
      return { updated: patches.length, setId: args.setId, totalCards: existing.length };
    },
  },

  deleteSet: {
    name: 'lerno_delete_set',
    description:
      'DESTRUCTIVE: permanently delete one of the authenticated student’s own study sets. ' +
      'Requires confirmation "DELETE" (exactly, capitals) — without it nothing is deleted. ' +
      'Only the owner can delete; other users’ sets answer NOT_FOUND. ' +
      'Deleting a set removes its cards, card progress, quizzes and quiz attempts; ' +
      'study sessions are kept but unlinked, subjects are untouched. This cannot be undone.',
    annotations: destructiveAnnotations,
    inputSchema: deleteSetInputSchema,
    async run(ctx: McpContext, args: DeleteSetInput): Promise<Record<string, unknown>> {
      const params = canonicalValidators.setParamsSchema.parse({ setId: args.setId });
      // Ownership pre-check (also fetches the title for the output); the
      // service re-checks authoritatively at delete time.
      const set = await ctx.db.sets.get(params.setId);
      if (!set || set.ownerId !== ctx.userId) throw errors.notFound('Study set not found');
      assertDeleteConfirmation(args.confirmation);
      await setService.remove(ctx.db, ctx.userId, params.setId);
      return { deleted: true, setId: params.setId, title: set.title };
    },
  },

  deleteCard: {
    name: 'lerno_delete_card',
    description:
      'DESTRUCTIVE: permanently delete one flashcard from one of the authenticated student’s own sets. ' +
      'Requires confirmation "DELETE" (exactly, capitals) — without it nothing is deleted. ' +
      'Only the set owner can delete cards; other users’ sets answer NOT_FOUND. ' +
      'The set’s quiz cache is invalidated (questions regenerate, attempts are kept). ' +
      'This cannot be undone.',
    annotations: destructiveAnnotations,
    inputSchema: deleteCardInputSchema,
    async run(ctx: McpContext, args: DeleteCardInput): Promise<Record<string, unknown>> {
      const params = canonicalValidators.cardParamsSchema.parse({
        setId: args.setId,
        cardId: args.cardId,
      });
      // Ownership/membership pre-check; the service re-checks authoritatively.
      const set = await ctx.db.sets.get(params.setId);
      if (!set || set.ownerId !== ctx.userId) throw errors.notFound('Study set not found');
      const card = await ctx.db.cards.get(params.cardId);
      if (!card || card.setId !== params.setId) throw errors.notFound('Card not found');
      assertDeleteConfirmation(args.confirmation);
      await setService.removeCard(ctx.db, ctx.userId, params.setId, params.cardId);
      return { deleted: true, setId: params.setId, cardId: params.cardId };
    },
  },

  startPractice: {
    name: 'lerno_start_practice',
    description:
      'Start a practice round: the set’s study queue (due, incorrect, difficult, new and ' +
      'already-studied cards, ' +
      'same order as the website’s Practice mode) with questions and answers. ' +
      'Ask the questions one by one and check the student’s answers against the answers provided. ' +
      'Read-only: answering here does not record progress — the student reviews on the website. ' +
      'The set must be owned by the caller or public; anything else returns NOT_FOUND.',
    annotations: readAnnotations,
    inputSchema: startPracticeInputSchema,
    async run(ctx: McpContext, args: StartPracticeInput): Promise<Record<string, unknown>> {
      const queue = await studyService.practiceQueue(ctx.db, ctx.userId, args.setId);
      const cards = args.limit ? queue.cards.slice(0, args.limit) : queue.cards;
      return {
        setId: queue.setId,
        title: queue.title,
        totalCards: queue.cards.length,
        returned: cards.length,
        cards: cards.map((entry) => ({
          id: entry.card.id,
          question: entry.card.question,
          answer: entry.card.answer,
          position: entry.card.position,
          reason: entry.reason,
        })),
      };
    },
  },

  startQuiz: {
    name: 'lerno_start_quiz',
    description:
      'Start a quiz on one set: the same generated quiz as the website (multiple choice, ' +
      'true/false, short answer — without correct answers). Ask the questions one by one; ' +
      'the student submits answers on the website, where scoring and attempts live. ' +
      'The set must be owned by the caller or public; anything else returns NOT_FOUND. Read-only.',
    annotations: readAnnotations,
    inputSchema: setIdInputSchema,
    async run(ctx: McpContext, args: SetIdInput): Promise<Record<string, unknown>> {
      const quiz = await quizService.loadForSet(ctx.db, ctx.userId, args.setId);
      return { questionCount: quiz.questions.length, quiz };
    },
  },

  getWrongCards: {
    name: 'lerno_get_wrong_cards',
    description:
      'Get the flashcards the student recently answered incorrectly, most recent first, ' +
      'with per-card mistake counts and set titles. Same progress data as the website. ' +
      'Use it to answer “which cards do I keep getting wrong?” or to drill difficult cards. ' +
      'Takes an optional set filter and limit. Read-only.',
    annotations: readAnnotations,
    inputSchema: wrongCardsInputSchema,
    async run(ctx: McpContext, args: WrongCardsInput): Promise<Record<string, unknown>> {
      const wrong = await studyService.wrongCards(ctx.db, ctx.userId, {
        setId: args.setId,
        limit: args.limit,
      });
      return { total: wrong.total, cards: wrong.cards };
    },
  },

  getStudyRecommendation: {
    name: 'lerno_get_study_recommendation',
    description:
      'Get the single most relevant thing to study next — the exact same recommendation ' +
      'as the website dashboard (“what should I learn now?”), with due counts, streak and ' +
      'daily-goal context. Takes no arguments. Read-only.',
    annotations: readAnnotations,
    inputSchema: emptyInputSchema,
    async run(ctx: McpContext, _args: EmptyInput): Promise<Record<string, unknown>> {
      const today = await retentionService.today(
        ctx.db,
        ctx.userId,
        new Date(),
        await resolveTimeZone(ctx.db, ctx.userId),
      );
      return {
        action: today.continueAction,
        context: {
          cardsDue: today.cardsDue,
          completedCards: today.completedCards,
          target: today.target,
          goalReached: today.goalReached,
          streak: today.streak,
          comeback: today.comeback,
        },
      };
    },
  },

  createStudyPlan: {
    name: 'lerno_create_study_plan',
    description:
      'Create a day-by-day study plan: due reviews first, then wrong cards, then new cards, ' +
      'spread over the requested days in daily-goal-sized suggestions. Derived from the ' +
      'student’s own sets, due reviews and progress — suggestions only, never obligations. ' +
      'Takes an optional day window (1–30, default 7) and an optional set filter. Read-only.',
    annotations: readAnnotations,
    inputSchema: studyPlanInputSchema,
    async run(ctx: McpContext, args: StudyPlanInput): Promise<Record<string, unknown>> {
      const plan = await retentionService.studyPlan(ctx.db, ctx.userId, {
        days: args.days,
        setIds: args.setIds,
        timeZone: await resolveTimeZone(ctx.db, ctx.userId),
      });
      return {
        days: plan.days,
        startDay: plan.startDay,
        totals: plan.totals,
        setsTruncated: plan.setsTruncated,
        plan: plan.plan,
        note: plan.note,
      };
    },
  },
};

export type McpToolName = keyof typeof mcpTools;
