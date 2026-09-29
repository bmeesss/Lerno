/**
 * Study Pack import — the "add study material" pipeline.
 *
 * One student action (paste text, upload a PDF, import an existing Lerno set)
 * becomes one Study Pack that already contains learning material:
 *
 *   material → source (stored) → concepts → summary → flashcards → practice → plan
 *
 * Design rules:
 *  - The Study Pack, its source and its content are written with the existing
 *    Study Pack service, so there is exactly one storage path and one
 *    authorization model (no parallel system).
 *  - Real stages only: progress is reported per stage that actually ran, and the
 *    status endpoint falls back to the database when a job is gone.
 *  - Lerno AI is optional. Without it the pack, the source and the deterministic
 *    study plan still exist; the UI shows "AI generation unavailable" instead of
 *    a broken flow, and content can be generated later.
 *  - Material Lerno cannot read is never processed: the source status reflects
 *    what really happened (`processing` → `ready` / `failed`).
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { Database } from '../lib/db/repository.js';
import { ApiError, errors } from '../lib/errors.js';
import {
  importJobs,
  type ImportCounts,
  type ImportJob,
  type ImportStageId,
  type ImportStepState,
} from '../lib/import-job-store.js';
import { extractPdfText } from './ai-studio-pdf.js';
import {
  detectMaterialConcepts,
  hasUsableMaterial,
  materialCharacterCount,
  materialFingerprint,
  materialWordCount,
  sanitizeMaterialText,
  type MaterialConceptCandidate,
} from './material-analysis.js';
import { studyPackGenerationService } from './study-pack-generation.js';
import { studyPackService } from './study-pack-service.js';

/** A job that runs longer than this is reported as failed (material is kept). */
export const IMPORT_DEADLINE_MS = 5 * 60 * 1000;
/** Only one import may process at a time per student (AI budget + fairness). */
export const MAX_ACTIVE_IMPORTS_PER_USER = 1;

export const IMPORT_STAGE_LABELS: Record<ImportStageId, string> = {
  concepts: 'Finding important concepts',
  summary: 'Writing a summary',
  flashcards: 'Creating flashcards',
  practice: 'Creating practice questions',
  plan: 'Building your study plan',
};

/** Order matters: concepts ground the cards and questions that follow. */
const AI_STAGES: ImportStageId[] = ['concepts', 'summary', 'flashcards', 'practice'];

export interface MaterialImportSource {
  type: 'text' | 'pdf' | 'set';
  title?: string;
  text?: string;
  pageCount?: number;
  setId?: string;
}

export interface StartImportInput {
  title: string;
  subjectId?: string | null;
  description?: string;
  level?: string;
  examDate?: string | null;
  source: MaterialImportSource;
  allowDuplicate?: boolean;
}

export interface ExistingMaterialRef {
  packId: string;
  packTitle: string;
  sourceId: string;
  sourceTitle: string;
  createdAt: string;
}

export interface PdfImportPreview {
  title: string;
  text: string;
  pageCount: number;
  wordCount: number;
  characterCount: number;
  truncated: boolean;
  concepts: MaterialConceptCandidate[];
}

export interface ImportJobStepView {
  id: ImportStageId;
  label: string;
  state: ImportStepState;
}

export interface ProcessingStatus {
  packId: string;
  status: 'processing' | 'ready' | 'partial' | 'failed';
  stage: ImportStageId | null;
  stageLabel: string | null;
  steps: ImportJobStepView[];
  aiAvailable: boolean;
  aiSkipped: boolean;
  counts: ImportCounts;
  failure: { stage: ImportStageId | null; message: string; details: string | null } | null;
  /** True while the backend is still working on this material. */
  processing: boolean;
}

/* --------------------------------- helpers -------------------------------- */

/** True when the server can actually run AI generation right now. */
export function isAiConfigured(): boolean {
  return Boolean(config.groqApiKey);
}

/** Sizes the generation to the material instead of always asking for a fixed batch. */
function generationSizes(wordCount: number): {
  concepts: number;
  flashcards: number;
  practice: number;
} {
  return {
    concepts: Math.min(20, Math.max(6, Math.round(wordCount / 100))),
    flashcards: Math.min(30, Math.max(8, Math.round(wordCount / 90))),
    practice: Math.min(15, Math.max(6, Math.round(wordCount / 140))),
  };
}

/** Maps any thrown value to a safe user message plus a short technical detail. */
function describeFailure(
  error: unknown,
  stage: ImportStageId,
): { message: string; details: string; aiUnavailable: boolean } {
  if (error instanceof ApiError) {
    return {
      message: error.message,
      details: `Stage: ${stage} · Code: ${error.code}`,
      aiUnavailable: error.code === 'AI_UNAVAILABLE',
    };
  }
  return {
    message: 'Something went wrong while building your study pack. Your material is saved.',
    details: `Stage: ${stage} · Code: INTERNAL_ERROR`,
    aiUnavailable: false,
  };
}

function stepsFromJob(job: ImportJob): ImportJobStepView[] {
  return job.steps.map((step) => ({
    id: step.id,
    label: IMPORT_STAGE_LABELS[step.id],
    state: step.state,
  }));
}

function activeStage(steps: ImportJobStepView[]): ImportStageId | null {
  return steps.find((step) => step.state === 'active')?.id ?? null;
}

function hasGeneratedContent(counts: ImportCounts): boolean {
  return (
    counts.concepts > 0 ||
    counts.flashcards > 0 ||
    counts.practiceQuestions > 0 ||
    counts.hasSummary ||
    counts.hasPlan
  );
}

/** Aggregate counts straight from the database (no job needed). */
async function storedCounts(db: Database, packId: string): Promise<ImportCounts> {
  const pack = await db.packs.get(packId);
  const [concepts, questions, set, plan] = await Promise.all([
    db.concepts.listByPack(packId),
    db.practiceQuestions.listByPack(packId),
    pack?.legacySetId ? db.sets.get(pack.legacySetId) : Promise.resolve(null),
    db.studyPlans.getByPack(packId),
  ]);
  const cards = set ? await db.cards.listBySet(set.id) : [];
  return {
    concepts: concepts.length,
    flashcards: cards.length,
    practiceQuestions: questions.length,
    hasSummary: Boolean(pack?.summary && pack.summary.trim().length > 0),
    hasPlan: Boolean(plan),
  };
}

/** Source status follows the job: readable material stays ready, hard failures are visible. */
async function settleSource(db: Database, sourceId: string | null, jobId: string): Promise<void> {
  if (!sourceId) return;
  const job = importJobs.get(jobId);
  if (!job) return;
  const failed = job.status === 'failed';
  try {
    await db.packSources.update(sourceId, {
      status: failed ? 'failed' : 'ready',
      failureReason: failed ? (job.failure?.message ?? "We couldn't process this file.") : null,
    });
  } catch {
    // A source status update must never break the import itself.
  }
}

/* --------------------------------- service -------------------------------- */

export const studyPackImportService = {
  /**
   * Reads a PDF server-side and returns what Lerno found — pages, words and
   * concept candidates that are really in the text. Nothing is stored yet: the
   * student sees this preview and confirms before a Study Pack is created.
   */
  async previewPdf(buffer: Buffer, filename: string): Promise<PdfImportPreview> {
    const extracted = await extractPdfText(buffer);
    const text = sanitizeMaterialText(extracted.text);
    if (!hasUsableMaterial(text)) {
      throw errors.validation(
        'We could not read enough text from this PDF. Paste the text instead.',
      );
    }
    return {
      title:
        filename
          .replace(/\.pdf$/i, '')
          .trim()
          .slice(0, 120) || 'PDF document',
      text,
      pageCount: extracted.pageCount,
      wordCount: materialWordCount(text),
      characterCount: materialCharacterCount(text),
      truncated: extracted.truncated,
      concepts: detectMaterialConcepts(text),
    };
  },

  /**
   * Finds an earlier import of the same material for this student. Comparison is
   * on a normalized content fingerprint, so a re-exported PDF or copied notes
   * are still recognised; the cheap character count filters candidates first.
   */
  async findExistingMaterial(
    db: Database,
    userId: string,
    text: string,
    options: { excludeSourceId?: string } = {},
  ): Promise<ExistingMaterialRef | null> {
    const characters = materialCharacterCount(text);
    if (characters === 0) return null;
    const fingerprint = materialFingerprint(text);
    const sources = await db.packSources.listByOwner(userId);
    const match = sources.find(
      (source) =>
        source.id !== options.excludeSourceId &&
        source.status !== 'failed' &&
        source.content !== null &&
        materialCharacterCount(source.content) === characters &&
        materialFingerprint(source.content) === fingerprint,
    );
    if (!match) return null;
    const [pack] = await db.packs.listByIds([match.packId]);
    return {
      packId: match.packId,
      packTitle: pack?.title ?? 'Study pack',
      sourceId: match.id,
      sourceTitle: match.title,
      createdAt: match.createdAt,
    };
  },

  /**
   * Creates the Study Pack with its first source and starts processing it.
   * Returns immediately: the student watches real stages through `status()`.
   */
  async startImport(
    db: Database,
    userId: string,
    input: StartImportInput,
  ): Promise<{ packId: string; jobId: string }> {
    if (importJobs.activeForUser(userId) >= MAX_ACTIVE_IMPORTS_PER_USER) {
      throw errors.rateLimited(
        'Lerno is still turning your previous material into a study pack. Try again in a moment.',
      );
    }

    const source = input.source;
    const sourceTitle =
      source.title?.trim() ||
      (source.type === 'set'
        ? 'Existing Lerno set'
        : source.type === 'pdf'
          ? 'PDF document'
          : 'Notes');
    const text = source.type === 'set' ? null : sanitizeMaterialText(source.text ?? '');
    if (text !== null && !hasUsableMaterial(text)) {
      throw errors.validation('Add at least 20 readable characters of study material.');
    }

    // Duplicate guard: an accidental second import is worse than a strict check.
    const existing = text
      ? await studyPackImportService.findExistingMaterial(db, userId, text)
      : null;
    if (existing && !input.allowDuplicate) {
      throw errors.conflict('This material may already exist in your study packs.', {
        reason: 'duplicate-source',
        packId: existing.packId,
        packTitle: existing.packTitle,
        sourceId: existing.sourceId,
        sourceTitle: existing.sourceTitle,
      });
    }

    // Reuse the Study Pack service for storage: one creation path, one
    // authorization model, exactly the same pack/set/source rows as before.
    const pack = await studyPackService.create(db, userId, {
      title: input.title,
      subjectId: input.subjectId ?? null,
      description: input.description ?? '',
      level: input.level ?? '',
      visibility: 'private',
      examDate: input.examDate ?? null,
      source:
        source.type === 'set'
          ? { type: 'set', setId: source.setId!, title: sourceTitle }
          : {
              type: source.type,
              title: sourceTitle,
              text: text!,
              ...(source.type === 'pdf' ? { pageCount: source.pageCount } : {}),
            },
    });

    const sources = await db.packSources.listByPack(pack.id);
    const created = sources.at(-1) ?? null;
    const wordCount = text ? materialWordCount(text) : 0;
    const aiAvailable = isAiConfigured();

    // Imported sets already hold flashcards: generate concepts, summary and
    // practice from them, but never pad the student's own cards.
    const stages: ImportStageId[] = [
      ...AI_STAGES.filter((stage) => !(source.type === 'set' && stage === 'flashcards')),
      'plan',
    ];

    const job = importJobs.start({
      id: randomUUID(),
      packId: pack.id,
      userId,
      steps: stages,
      aiAvailable,
    });
    if (created) await db.packSources.update(created.id, { status: 'processing' });

    void runImport({
      db,
      userId,
      packId: pack.id,
      jobId: job.id,
      sourceId: created?.id ?? null,
      wordCount,
    }).catch(() => {
      // runImport never throws by design; this is the last safety net so a
      // background failure cannot crash the process.
    });

    return { packId: pack.id, jobId: job.id };
  },

  /**
   * The processing status of a pack: real stages while a job runs, and a
   * database-derived answer when no job exists (server restart, older import).
   */
  async status(db: Database, userId: string, packId: string): Promise<ProcessingStatus> {
    const pack = await db.packs.get(packId);
    if (!pack || pack.ownerId !== userId) throw errors.notFound('Study pack not found');
    const sources = await db.packSources.listByPack(packId);
    const job = importJobs.getByPack(packId);

    if (job && job.status === 'processing') {
      const steps = stepsFromJob(job);
      const stage = activeStage(steps);
      return {
        packId,
        status: 'processing',
        stage,
        stageLabel: stage ? IMPORT_STAGE_LABELS[stage] : 'Preparing your study pack',
        steps,
        aiAvailable: job.aiAvailable,
        aiSkipped: job.aiSkipped,
        counts: job.counts,
        failure: job.failure,
        processing: true,
      };
    }

    if (job) {
      return {
        packId,
        status: job.status,
        stage: null,
        stageLabel: null,
        steps: stepsFromJob(job),
        aiAvailable: job.aiAvailable,
        aiSkipped: job.aiSkipped,
        counts: job.counts,
        failure: job.failure,
        processing: false,
      };
    }

    // No job in memory: derive the truth from what is actually stored.
    const counts = await storedCounts(db, packId);
    const failed = sources.find((source) => source.status === 'failed') ?? null;
    const processing = sources.some((source) => source.status === 'processing');
    const content = hasGeneratedContent(counts);
    const steps: ImportJobStepView[] = (Object.keys(IMPORT_STAGE_LABELS) as ImportStageId[]).map(
      (id) => ({
        id,
        label: IMPORT_STAGE_LABELS[id],
        state: processing
          ? ('pending' as const)
          : content
            ? ('done' as const)
            : ('pending' as const),
      }),
    );
    return {
      packId,
      status: processing ? 'processing' : failed && !content ? 'failed' : 'ready',
      stage: processing ? 'concepts' : null,
      stageLabel: processing ? IMPORT_STAGE_LABELS.concepts : null,
      steps,
      aiAvailable: isAiConfigured(),
      aiSkipped: false,
      counts,
      failure: failed
        ? {
            stage: null,
            message: failed.failureReason ?? "We couldn't process this file.",
            details: `Source: ${failed.id} · Status: failed`,
          }
        : null,
      processing,
    };
  },

  /**
   * Starts (or retries) generation for a pack that already has readable
   * material — used by "Try again" and by "Generate now" when AI was not
   * configured during the first import.
   */
  async startProcessing(
    db: Database,
    userId: string,
    packId: string,
    options: { sourceId?: string | null } = {},
  ): Promise<ProcessingStatus> {
    const pack = await db.packs.get(packId);
    if (!pack || pack.ownerId !== userId) throw errors.notFound('Study pack not found');
    const running = importJobs.getByPack(packId);
    if (running && running.status === 'processing') {
      return studyPackImportService.status(db, userId, packId);
    }

    const sources = await db.packSources.listByPack(packId);
    const usable = sources.filter((source) => (source.content ?? '').trim().length > 0);
    const chosen = options.sourceId
      ? usable.find((source) => source.id === options.sourceId)
      : usable.at(-1);
    if (!chosen) {
      throw errors.validation('Add readable material to this study pack first.');
    }
    if (importJobs.activeForUser(userId) >= MAX_ACTIVE_IMPORTS_PER_USER) {
      throw errors.rateLimited('Lerno is still working on other material. Try again in a moment.');
    }

    const sourceType: 'text' | 'pdf' | 'set' =
      chosen.kind === 'set' ? 'set' : chosen.kind === 'pdf' ? 'pdf' : 'text';
    const job = importJobs.start({
      id: randomUUID(),
      packId,
      userId,
      steps: [
        ...AI_STAGES.filter((stage) => !(sourceType === 'set' && stage === 'flashcards')),
        'plan',
      ],
      aiAvailable: isAiConfigured(),
    });
    await db.packSources.update(chosen.id, { status: 'processing', failureReason: null });

    void runImport({
      db,
      userId,
      packId,
      jobId: job.id,
      sourceId: chosen.id,
      wordCount: materialWordCount(chosen.content ?? ''),
    }).catch(() => undefined);

    return studyPackImportService.status(db, userId, packId);
  },
};

/**
 * The background pipeline. Every stage is independent: a failing stage stops the
 * rest of the AI work (no point hammering a broken provider) but never removes
 * what was already stored, and the study plan is always built because it is
 * deterministic and needs no AI.
 */
async function runImport(params: {
  db: Database;
  userId: string;
  packId: string;
  jobId: string;
  sourceId: string | null;
  wordCount: number;
}): Promise<void> {
  const { db, userId, packId, jobId, sourceId } = params;
  const sizes = generationSizes(params.wordCount);
  const deadline = Date.now() + IMPORT_DEADLINE_MS;
  let generated = false;

  try {
    if (!isAiConfigured()) {
      importJobs.update(jobId, {
        aiAvailable: false,
        aiSkipped: true,
        steps: importJobs
          .get(jobId)!
          .steps.map((step) =>
            step.id === 'plan' ? step : { ...step, state: 'skipped' as const },
          ),
      });
    } else {
      for (const stage of AI_STAGES) {
        const job = importJobs.get(jobId);
        if (!job) return;
        const step = job.steps.find((entry) => entry.id === stage);
        if (!step || step.state === 'skipped') continue;

        if (Date.now() > deadline) {
          importJobs.fail(
            jobId,
            {
              stage,
              message:
                'This is taking longer than expected. Your material is saved — try again in a moment.',
              details: `Stage: ${stage} · Code: AI_TIMEOUT`,
            },
            { status: generated ? 'partial' : 'failed', skipRemainingAi: true },
          );
          await settleSource(db, sourceId, jobId);
          return;
        }

        importJobs.enterStage(jobId, stage);
        try {
          const produced = await runStage({ db, userId, packId, sourceId, stage, sizes });
          if (produced) generated = true;
          importJobs.completeStage(jobId, stage, produced ?? {});
        } catch (error) {
          const failure = describeFailure(error, stage);
          if (failure.aiUnavailable) {
            // No AI configured / credentials rejected: keep the material and
            // the pack, skip the rest of the AI work.
            importJobs.fail(
              jobId,
              {
                stage,
                message: 'AI generation is unavailable right now. Your material is saved.',
                details: failure.details,
              },
              { status: 'ready', skipRemainingAi: true },
            );
            break;
          }
          importJobs.fail(
            jobId,
            { stage, message: failure.message, details: failure.details },
            { status: generated ? 'partial' : 'failed', skipRemainingAi: true },
          );
          await settleSource(db, sourceId, jobId);
          return;
        }
      }
    }

    // Deterministic study plan: built from the pack's real counts, no AI.
    const beforePlan = importJobs.get(jobId);
    if (!beforePlan) return;
    importJobs.enterStage(jobId, 'plan');
    try {
      await studyPackService.createPlan(db, userId, packId, { minutesPerDay: 30 });
      importJobs.completeStage(jobId, 'plan', { hasPlan: true });
    } catch (error) {
      const failure = describeFailure(error, 'plan');
      importJobs.fail(
        jobId,
        { stage: 'plan', message: failure.message, details: failure.details },
        { status: generated ? 'partial' : 'failed', skipRemainingAi: false },
      );
      await settleSource(db, sourceId, jobId);
      return;
    }

    const finished = importJobs.get(jobId);
    if (finished && finished.status === 'processing') importJobs.finish(jobId, {});
    await settleSource(db, sourceId, jobId);
  } catch {
    // Nothing here may escape: the student's material is already stored.
    const job = importJobs.get(jobId);
    if (job && job.status === 'processing') {
      importJobs.fail(
        jobId,
        {
          stage: null,
          message: 'Something went wrong while building your study pack. Your material is saved.',
          details: 'Code: INTERNAL_ERROR',
        },
        { status: generated ? 'partial' : 'failed', skipRemainingAi: true },
      );
    }
    await settleSource(db, sourceId, jobId);
  }
}

/** Runs one generation stage and stores its confirmed content. */
async function runStage(params: {
  db: Database;
  userId: string;
  packId: string;
  sourceId: string | null;
  stage: ImportStageId;
  sizes: { concepts: number; flashcards: number; practice: number };
}): Promise<Partial<ImportCounts> | null> {
  const { db, userId, packId, sourceId, stage, sizes } = params;

  if (stage === 'concepts') {
    const preview = await studyPackGenerationService.generate(db, userId, packId, {
      target: 'concepts',
      sourceId,
      count: sizes.concepts,
    });
    if (preview.target !== 'concepts' || preview.concepts.length === 0) return null;
    const stored = await studyPackService.applyContent(db, userId, packId, {
      target: 'concepts',
      concepts: preview.concepts.map((concept) => ({
        name: concept.name,
        explanation: concept.explanation,
      })),
      sourceId: preview.concepts[0]?.sourceId ?? sourceId,
    });
    return { concepts: 'added' in stored ? stored.added : preview.concepts.length };
  }

  if (stage === 'summary') {
    const preview = await studyPackGenerationService.generate(db, userId, packId, {
      target: 'summary',
      sourceId,
    });
    if (preview.target !== 'summary' || !preview.summary.trim()) return null;
    await studyPackService.applyContent(db, userId, packId, {
      target: 'summary',
      summary: preview.summary.trim(),
      sourceId: preview.sourceId ?? sourceId,
    });
    return { hasSummary: true };
  }

  if (stage === 'flashcards') {
    const preview = await studyPackGenerationService.generate(db, userId, packId, {
      target: 'flashcards',
      sourceId,
      count: sizes.flashcards,
    });
    if (preview.target !== 'flashcards' || preview.cards.length === 0) return null;
    const stored = await studyPackService.applyContent(db, userId, packId, {
      target: 'flashcards',
      cards: preview.cards.map((card) => ({ front: card.front, back: card.back })),
      sourceId: preview.sourceId ?? sourceId,
    });
    return { flashcards: 'added' in stored ? stored.added : preview.cards.length };
  }

  const preview = await studyPackGenerationService.generate(db, userId, packId, {
    target: 'practice',
    sourceId,
    count: sizes.practice,
  });
  if (preview.target !== 'practice' || preview.questions.length === 0) return null;
  const stored = await studyPackService.applyContent(db, userId, packId, {
    target: 'practice',
    questions: preview.questions.map((question) => ({
      questionType: question.questionType,
      prompt: question.prompt,
      correctAnswer: question.correctAnswer,
      options: question.options,
      explanation: question.explanation,
    })),
    sourceId: preview.questions[0]?.sourceId ?? sourceId,
  });
  return { practiceQuestions: 'added' in stored ? stored.added : preview.questions.length };
}
