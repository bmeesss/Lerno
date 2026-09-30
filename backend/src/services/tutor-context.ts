/**
 * AI Tutor context — what the tutor knows when it is opened from a concept or a
 * study session, and how honest its answer is about where it comes from.
 *
 * Everything the model receives is assembled here, deterministically:
 *  - the pack's normalized sources with their `[[n:marker]]` provenance tokens
 *    (the concept's own source first),
 *  - the concept in focus: its approved explanation, flashcards and the
 *    student's recent mistakes on it,
 *  - the question on screen — without its answer while it is still unanswered.
 *
 * A running test switches the tutor off (a hint would be an answer). The reply
 * is labelled "Based on your material" only when it carries a citation that
 * resolves to a real source of the pack; anything else is a general explanation.
 */
import type { Database } from '../lib/db/repository.js';
import type { StudyPackSourceRecord } from '../lib/db/types.js';
import { sanitizeChatText } from '../lib/ai-sanitize.js';
import { errors } from '../lib/errors.js';
import { runTextAiTask } from './ai-tasks.js';
import { isOpenStatus } from './session-model.js';
import { isReadableSource, type PackAiInput } from './study-pack-ai.js';
import { buildSourceContext, toNormalizedSource } from './source-normalize.js';
import type { TutorBody } from '../validators/study-pack.validators.js';

export interface TutorCitation {
  sourceId: string;
  title: string;
  /** "page 6" when the cited place really exists in that source. */
  ref: string | null;
}

export interface TutorFocus {
  concept: {
    id: string;
    name: string;
    explanation: string;
    refLabel: string | null;
    sourceId: string | null;
  };
  masteryPercent: number | null;
  flashcards: { question: string; answer: string }[];
  mistakes: { prompt: string; yourAnswer: string; correctAnswer: string; explanation: string }[];
  /** The question the student is looking at; the answer only once it was answered. */
  question: { prompt: string; correctAnswer?: string; explanation?: string } | null;
  session: { type: string; label: string } | null;
}

const MAX_MISTAKES = 3;
const MAX_CARDS = 4;

/** `[Source: Biology.md · page 6]` — the citation form the tutor prompt asks for. */
const CITATION = /\[Source:\s*([^\]·]+?)(?:\s*·\s*([^\]]+?))?\s*\]/gi;

const normalizeTitle = (value: string) => value.trim().toLowerCase();

/**
 * Citations in a reply that resolve to a real source of the pack. A title that
 * matches no source is dropped, and so is a place that source does not have —
 * invented provenance is never shown.
 */
export function extractCitations(
  reply: string,
  sources: Pick<StudyPackSourceRecord, 'id' | 'title' | 'metadata'>[],
): TutorCitation[] {
  const found = new Map<string, TutorCitation>();
  for (const match of reply.matchAll(CITATION)) {
    const cited = normalizeTitle(match[1] ?? '');
    if (!cited) continue;
    const source = sources.find((candidate) => {
      const title = normalizeTitle(candidate.title);
      return title === cited || title.includes(cited) || cited.includes(title);
    });
    if (!source) continue;
    const label = match[2]?.trim() ?? null;
    const known = (source.metadata?.references ?? []).some(
      (reference) => reference.label.trim().toLowerCase() === label?.toLowerCase(),
    );
    const key = `${source.id}:${known ? label : ''}`;
    if (!found.has(key)) {
      found.set(key, { sourceId: source.id, title: source.title, ref: known ? label : null });
    }
  }
  return [...found.values()];
}

export async function buildTutorFocus(
  db: Database,
  userId: string,
  input: PackAiInput,
  context: NonNullable<TutorBody['context']>,
): Promise<TutorFocus | null> {
  let session = null;
  let item = null;
  if (context.sessionId) {
    session = await db.learningSessions.get(context.sessionId);
    if (!session || session.userId !== userId || session.packId !== input.pack.id) {
      throw errors.notFound('Study session not found');
    }
    // A hint during a test would be an answer.
    if (session.type === 'test' && isOpenStatus(session.status)) {
      throw errors.conflict('The AI Tutor is switched off while a test is running');
    }
    if (context.itemId) {
      const items = await db.learningSessionItems.listBySession(session.id);
      item = items.find((entry) => entry.id === context.itemId) ?? null;
      if (!item) throw errors.notFound('Session item not found');
    }
  } else if (context.itemId) {
    throw errors.validation('An item needs its study session');
  }

  const conceptId = context.conceptId ?? item?.conceptId ?? null;
  if (!conceptId) return null;
  const concept = input.concepts.find((entry) => entry.id === conceptId);
  if (!concept) throw errors.notFound('Concept not found');

  const [mastery, attempts] = await Promise.all([
    db.conceptMastery.get(userId, concept.id),
    db.practiceAttempts.listByUserAndPack(userId, input.pack.id),
  ]);
  const questions = new Map((input.questions ?? []).map((question) => [question.id, question]));
  const mistakes = attempts
    .filter((attempt) => attempt.conceptId === concept.id && attempt.verdict === 'incorrect')
    .slice(0, MAX_MISTAKES)
    .flatMap((attempt) => {
      const question = questions.get(attempt.questionId);
      return question
        ? [
            {
              prompt: question.prompt,
              yourAnswer: attempt.answer,
              correctAnswer: question.correctAnswer,
              explanation: question.explanation,
            },
          ]
        : [];
    });

  const shown = item?.questionId ? questions.get(item.questionId) : undefined;
  const answered = item ? item.verdict !== null : false;
  return {
    concept: {
      id: concept.id,
      name: concept.name,
      explanation: concept.explanation,
      refLabel: concept.refLabel,
      sourceId: concept.sourceId,
    },
    masteryPercent: mastery ? Math.round(mastery.mastery * 100) : null,
    flashcards: (input.cards ?? [])
      .filter((card) => card.conceptId === concept.id)
      .slice(0, MAX_CARDS)
      .map((card) => ({ question: card.question, answer: card.answer })),
    mistakes,
    question: shown
      ? {
          prompt: shown.prompt,
          ...(answered
            ? { correctAnswer: shown.correctAnswer, explanation: shown.explanation }
            : {}),
        }
      : null,
    session: session ? { type: session.type, label: session.title } : null,
  };
}

/** Sources with readable text, the concept's own source first. */
function orderedSources(input: PackAiInput, focus: TutorFocus | null): StudyPackSourceRecord[] {
  const readable = input.sources.filter((source) => isReadableSource(source));
  const first = focus?.concept.sourceId;
  return first
    ? [
        ...readable.filter((source) => source.id === first),
        ...readable.filter((source) => source.id !== first),
      ]
    : readable;
}

export const tutorService = {
  async reply(db: Database, userId: string, input: PackAiInput, body: TutorBody) {
    const focus = body.context ? await buildTutorFocus(db, userId, input, body.context) : null;
    const sources = orderedSources(input, focus);
    const sourceContext = buildSourceContext(sources.map(toNormalizedSource), { maxChars: 9_000 });

    const payload = JSON.stringify({
      pack: {
        title: input.pack.title,
        subject: input.pack.subjectName,
        level: input.pack.level || null,
      },
      source: sourceContext.text,
      ...(focus
        ? {
            focus,
            note:
              "The student is looking at the concept in 'focus'. Explain that concept first, tailored to their recent mistakes. " +
              "Flashcards and mistakes are the student's own material, not source claims: only cite the source block.",
          }
        : {}),
      recentConversation: body.history.slice(-8).map((entry) => ({
        role: entry.role,
        content: sanitizeChatText(entry.content, 1_000),
      })),
      latestQuestion: sanitizeChatText(body.message, 1_500),
    });

    const { text } = await runTextAiTask({
      task: 'studio-chat',
      payload,
      contextSource: 'document',
      logMeta: {
        packId: input.pack.id,
        sourceCount: sourceContext.usedSourceIds.length,
        focused: Boolean(focus),
      },
    });
    const citations = extractCitations(text, input.sources);
    return {
      reply: text,
      /** True only when the reply cites a real source of this pack. */
      basedOnMaterial: citations.length > 0,
      citations,
      focus: focus ? { conceptId: focus.concept.id, conceptName: focus.concept.name } : null,
    };
  },
};
