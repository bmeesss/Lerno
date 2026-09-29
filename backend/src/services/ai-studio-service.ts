import type { z } from 'zod';
import type { Database } from '../lib/db/repository.js';
import { errors } from '../lib/errors.js';
import { sanitizeChatText } from '../lib/ai-sanitize.js';
import { runStructuredAiTask, runTextAiTask } from './ai-tasks.js';
import {
  generatedCardsSchema,
  generatedQuestionsSchema,
  generatedQuizSchema,
  generatedStudyPlanSchema,
  generatedSummarySchema,
} from '../lib/ai-schemas.js';
import { buildSetSourceContext, buildTextContext } from '../lib/ai-studio-context.js';
import type { AiContextSource } from '../lib/ai-context-source.js';
import type { AiTaskName } from './ai-prompts.js';
import { loadSetForAi } from './ai-learning-service.js';
import { extractPdfText } from './ai-studio-pdf.js';
import type {
  StudioActionSource,
  StudioCardsRequest,
  StudioChatRequest,
  StudioQuestionsRequest,
  StudioPlanRequest,
  StudioQuizRequest,
} from '../validators/ai-studio.validators.js';

export interface ExtractedStudioPdf {
  title: string;
  text: string;
  pageCount: number;
  characterCount: number;
  truncated: boolean;
}

interface ResolvedSource {
  title: string;
  kind: StudioActionSource['type'];
  context: string;
  contextSource: AiContextSource;
  characterCount: number;
}

function safeTitle(value: string, fallback: string): string {
  return sanitizeChatText(value, 120).replace(/\s+/g, ' ').trim() || fallback;
}

/** Extract a PDF in memory; return its text only to the authenticated uploader. */
export async function extractStudioPdf(buffer: Buffer, requestedTitle: string): Promise<ExtractedStudioPdf> {
  const extracted = await extractPdfText(buffer);
  const text = sanitizeChatText(extracted.text, 50_000);
  if (text.replace(/\s/g, '').length < 20) {
    throw errors.validation('This PDF has no readable selectable text. Scanned or image-only PDFs are not supported; paste the text instead.');
  }
  return {
    title: safeTitle(requestedTitle, 'PDF study material'),
    text,
    pageCount: extracted.pageCount,
    characterCount: extracted.extractedChars,
    truncated: extracted.truncated || extracted.text.length > text.length,
  };
}

async function resolveSource(
  db: Database,
  userId: string,
  input: StudioActionSource,
  taskBudget: number,
): Promise<ResolvedSource> {
  if (input.type === 'set') {
    // Set IDs are data references, never trusted client permissions. Re-run the
    // existing canViewSet path before every task and give Groq only bounded text.
    const loaded = await loadSetForAi(db, userId, input.setId);
    return {
      title: loaded.set.title,
      kind: 'set',
      context: buildSetSourceContext(loaded.set.title, loaded.context, taskBudget),
      contextSource: 'set',
      characterCount: loaded.context.length,
    };
  }
  const title = safeTitle(input.title, 'Study material');
  const text = sanitizeChatText(input.text, 50_000);
  if (text.replace(/\s/g, '').length < 20) {
    throw errors.validation('Add at least 20 readable characters of study material.');
  }
  return {
    title,
    kind: input.type,
    context: buildTextContext({
      title,
      kind: input.type,
      text,
      pageCount: input.pageCount,
      extractedChars: input.extractedChars ?? text.length,
      truncated: input.truncated,
    }, taskBudget),
    contextSource: input.type === 'pdf' ? 'document' : 'text',
    characterCount: input.extractedChars ?? text.length,
  };
}

function payload(source: ResolvedSource, request: Record<string, unknown>): string {
  // Serialize source text and user controls as data rather than interpolating
  // them into system instructions or giving the model database/file access.
  return JSON.stringify({ source: source.context, request });
}

interface StructuredRunOptions<S extends z.ZodTypeAny> {
  task: Extract<AiTaskName, `studio-${string}`>;
  source: ResolvedSource;
  payload: string;
  schema: S;
  maxOutputTokens?: number;
  validCount?: (value: z.infer<S>) => boolean;
}

/** Studio task run: shared runner + studio-level provenance logging. */
async function runStructured<S extends z.ZodTypeAny>(
  options: StructuredRunOptions<S>,
): Promise<z.infer<S>> {
  const { data } = await runStructuredAiTask({
    task: options.task,
    payload: options.payload,
    schema: options.schema,
    contextSource: options.source.contextSource,
    maxOutputTokens: options.maxOutputTokens,
    validCount: options.validCount,
    logMeta: {
      sourceType: options.source.kind,
      sourceChars: options.source.characterCount,
    },
  });
  return data;
}

export async function summarizeStudioSource(
  db: Database,
  userId: string,
  input: StudioActionSource,
) {
  const source = await resolveSource(db, userId, input, 14_000);
  const result = await runStructured({
    task: 'studio-summary',
    source,
    payload: payload(source, { action: 'summary' }),
    schema: generatedSummarySchema,
  });
  return { ...result, sourceTitle: source.title };
}

export async function generateStudioCards(
  db: Database,
  userId: string,
  request: StudioCardsRequest,
) {
  const source = await resolveSource(db, userId, request.source, 12_000);
  return runStructured({
    task: 'studio-cards',
    source,
    payload: payload(source, { action: 'flashcards', count: request.count }),
    schema: generatedCardsSchema,
    maxOutputTokens: Math.min(3_600, 350 + request.count * 110),
    validCount: (value) => value.cards.length === request.count,
  });
}

export async function generateStudioQuiz(
  db: Database,
  userId: string,
  request: StudioQuizRequest,
) {
  const source = await resolveSource(db, userId, request.source, 12_000);
  return runStructured({
    task: 'studio-quiz',
    source,
    payload: payload(source, { action: 'quiz', count: request.count, types: request.types }),
    schema: generatedQuizSchema,
    maxOutputTokens: Math.min(3_000, 350 + request.count * 180),
    validCount: (value) =>
      value.questions.length === request.count &&
      value.questions.every((question) => request.types.includes(question.type)),
  });
}

export async function generateStudioQuestions(
  db: Database,
  userId: string,
  request: StudioQuestionsRequest,
) {
  const source = await resolveSource(db, userId, request.source, 11_000);
  return runStructured({
    task: 'studio-questions',
    source,
    payload: payload(source, { action: 'practice questions', count: request.count, difficulty: request.difficulty }),
    schema: generatedQuestionsSchema,
    maxOutputTokens: Math.min(2_800, 350 + request.count * 150),
    validCount: (value) => value.questions.length === request.count,
  });
}

export async function createStudioPlan(
  db: Database,
  userId: string,
  request: StudioPlanRequest,
) {
  const source = await resolveSource(db, userId, request.source, 10_000);
  return runStructured({
    task: 'studio-plan',
    source,
    payload: payload(source, {
      action: 'study plan',
      days: request.days,
      minutesPerDay: request.minutesPerDay,
    }),
    schema: generatedStudyPlanSchema,
    maxOutputTokens: Math.min(2_800, 400 + request.days * 165),
    validCount: (value) =>
      value.sessions.length === request.days &&
      value.sessions.every((session, index) => session.day === index + 1 && session.minutes === request.minutesPerDay),
  });
}

export async function chatWithStudioSource(
  db: Database,
  userId: string,
  request: StudioChatRequest,
) {
  const source = await resolveSource(db, userId, request.source, 9_000);
  const history = request.history.slice(-8).map((message) => ({
    role: message.role,
    content: sanitizeChatText(message.content, 1_000),
  }));
  const conversationPayload = JSON.stringify({
    source: source.context,
    recentConversation: history,
    latestQuestion: sanitizeChatText(request.message, 1_500),
  });
  const { text } = await runTextAiTask({
    task: 'studio-chat',
    payload: conversationPayload,
    contextSource: source.contextSource,
    logMeta: {
      sourceType: source.kind,
      sourceChars: source.characterCount,
    },
  });
  return { reply: text };
}
