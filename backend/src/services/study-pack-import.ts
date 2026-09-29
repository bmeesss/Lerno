/**
 * Study Pack import — the one "add study material" pipeline.
 *
 * Every source kind takes the same road, and the student watches the same real
 * stages whichever they picked:
 *
 *   Source → Validate → Extract → Normalize → Analyze → Generate → Review → Ready
 *
 *   extract   — read the material (PDF pages, PPTX slides, image OCR, audio
 *               transcript, YouTube captions the student pasted, pasted text)
 *   normalize — one internal representation: text + sections + references + metadata
 *   analyze   — one source-grounded AI analysis (summary, concepts, key facts,
 *               exam topics, difficulty, conflicts between sources)
 *   generate  — flashcards and practice questions from that same analysis
 *   review    — the automatic quality check (duplicates, empties, long/unanwerable
 *               items); bad output is dropped, never shown
 *   plan      — the deterministic study plan (no AI needed)
 *
 * Design rules (unchanged from the previous import flow, deliberately):
 *  - there is exactly one storage path: the Study Pack service
 *  - there is exactly one job/progress system: `lib/import-job-store.ts`
 *  - AI is optional: without it the material, the pack and the plan still exist,
 *    and the UI says so honestly instead of faking content
 *  - every stage can be retried on its own; retries never duplicate content and
 *    never require re-uploading while the upload is still in memory
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { Database } from '../lib/db/repository.js';
import type {
  ConceptRecord,
  PracticeQuestionRecord,
  StudyPackSourceRecord,
} from '../lib/db/types.js';
import { errors, ApiError } from '../lib/errors.js';
import {
  importJobs,
  type ImportCounts,
  type ImportJob,
  type ImportStageId,
  type ImportStepState,
} from '../lib/import-job-store.js';
import {
  EMPTY_SOURCE_METADATA,
  type GenerationLanguage,
  type SourceReferenceKind,
} from '../lib/source-model.js';
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
import {
  pendingSourceInputs,
  type PendingSourceInput,
} from './pending-source-inputs.js';
import { parseYouTubeVideoId } from './source-youtube.js';
import { analyzeSources, type SourceAnalysisResult } from './source-analysis.js';
import { extractSource, type ExtractionOutcome } from './source-extract.js';
import {
  detectTextSections,
  normalizeChunks,
  toNormalizedSource,
  type NormalizedSource,
} from './source-normalize.js';
import {
  generateContent,
  normalizeGenerationSettings,
  type GenerationSettings,
} from './source-generation.js';
import { estimateStudyTime } from './study-time.js';
import { studyPackService } from './study-pack-service.js';

/** A job that runs longer than this is reported as failed (material is kept). */
export const IMPORT_DEADLINE_MS = 5 * 60 * 1000;
/** Only one import may process at a time per student (AI budget + fairness). */
export const MAX_ACTIVE_IMPORTS_PER_USER = 1;

export const IMPORT_STAGE_LABELS: Record<ImportStageId, string> = {
  extract: 'Reading your material',
  normalize: 'Cleaning up your material',
  analyze: 'Understanding your material',
  generate: 'Creating concepts, summary, flashcards and practice',
  review: 'Checking the generated content',
  plan: 'Building your study plan',
};

/** The full pipeline, in order. */export const PIPELINE_STAGES: ImportStageId[] = [
  'extract',
  'normalize',
  'analyze',
  'generate',
  'review',
  'plan',
];

/** Stages that need Lerno AI; without it they are reported as skipped. */
const AI_STAGES: ImportStageId[] = ['analyze', 'generate', 'review'];

export interface MaterialImportSource {
  type: 'text' | 'pdf' | 'set';
  title?: string;
  text?: string;
  pageCount?: number;
  setId?: string;
}

/** A source that is uploaded as a file and read server-side. */
export interface UploadImportSource {
  type: 'pdf' | 'powerpoint' | 'image' | 'audio';
  title: string;
  file: { buffer: Buffer; filename: string; mimeType: string };
}

/** A YouTube source: public metadata plus captions the student pasted. */
export interface YouTubeImportSource {
  type: 'youtube';
  title?: string;
  url: string;
  transcript?: string;
}

export type ImportSourceInput = MaterialImportSource | UploadImportSource | YouTubeImportSource;

/**
 * A PDF can arrive as pasted text (the browser previewed it) or as an uploaded
 * file (the server reads it). The two share the `pdf` type, so the file itself
 * is what tells them apart.
 */
function isUploadSource(source: ImportSourceInput): source is UploadImportSource {
  return 'file' in source && source.file !== undefined;
}

export interface StartImportInput {
  title: string;
  subjectId?: string | null;
  description?: string;
  level?: string;
  examDate?: string | null;
  source: ImportSourceInput;
  allowDuplicate?: boolean;
  settings?: Partial<GenerationSettings> | null;
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

export interface SourceStatusView {
  id: string;
  title: string;
  kind: string;
  status: string;
  stage: string | null;
  failureReason: string | null;
  /** Provenance label of the source itself ("page 6" style labels live per item). */
  referenceLabel: string | null;
  retryable: boolean;
  /** Canonical source URL (YouTube); null for everything else. */
  url: string | null;
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
  /** Every source of this pack with its own lifecycle state. */
  sources: SourceStatusView[];
  /** Rule-based study time estimate, computed server-side. */
  estimatedMinutes: number | null;
  estimatedStudyTimeLabel: string | null;
  /** True when the pack has material the student can actually study. */
  ready: boolean;
}

/* --------------------------------- helpers -------------------------------- */

/** True when the server can actually run AI generation right now. */
export function isAiConfigured(): boolean {
  return Boolean(config.groqApiKey);
}

/** `added` is only present on additive results — one safe reader for all targets. */
function addedCount(result: unknown): number | null {
  const value = (result as { added?: unknown }).added;
  return typeof value === 'number' ? value : null;
}

/** Maps a pipeline stage onto the source stage stored on the source row. */
function sourceStageFor(stage: ImportStageId): 'extract' | 'normalize' | 'analyze' | 'generate' | 'review' | null {
  return stage === 'plan' ? null : stage;
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

/** Aggregate counts straight from the database (no job needed). */
async function storedCounts(db: Database, packId: string): Promise<ImportCounts> {
  const pack = await db.packs.get(packId);
  const [concepts, questions, set, plan, sources] = await Promise.all([
    db.concepts.listByPack(packId),
    db.practiceQuestions.listByPack(packId),
    pack?.legacySetId ? db.sets.get(pack.legacySetId) : Promise.resolve(null),
    db.studyPlans.getByPack(packId),
    db.packSources.listByPack(packId),
  ]);
  const cards = set ? await db.cards.listBySet(set.id) : [];
  return {
    sources: sources.length,
    readySources: sources.filter(
      (source) => source.status === 'ready' || (source.content ?? '').trim().length > 0,
    ).length,
    concepts: concepts.length,
    flashcards: cards.length,
    practiceQuestions: questions.length,
    hasSummary: Boolean(pack?.summary && pack.summary.trim().length > 0),
    hasPlan: Boolean(plan),
    hasAnalysis: Boolean(pack?.analysis),
    conflicts: pack?.analysis?.conflicts.length ?? 0,
    rejected: 0,
  };
}

/** Source status follows the run: readable material stays ready, failures show. */
async function settleSource(db: Database, sourceId: string | null, jobId: string): Promise<void> {
  if (!sourceId) return;
  const job = importJobs.get(jobId);
  if (!job) return;
  const failed = job.status === 'failed';
  const stage = job.failure?.stage ?? null;
  try {
    await db.packSources.update(sourceId, {
      status: failed ? 'failed' : 'ready',
      failureReason: failed ? (job.failure?.message ?? "We couldn't process this file.") : null,
      processingStage: failed ? sourceStageFor(stage ?? 'extract') : 'review',
    });
  } catch {
    // A source status update must never break the import itself.
  }
}

/** Sources the student can study from right now. */
function readableSources(sources: { content: string | null; status: string }[]): number {
  return sources.filter((source) => source.status !== 'failed' && (source.content ?? '').trim())
    .length;
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
   * Creates the Study Pack with its first source and starts the pipeline.
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
    const uploaded = isUploadSource(source);
    const sourceTitle = defaultSourceTitle(source);
    /**
     * Only pasted material and sets arrive with their text: anything uploaded as
     * a file (including a PDF) is read by the pipeline itself, so it must never
     * be treated as an empty text source.
     */
    const text = isUploadSource(source)
      ? null
      : source.type === 'text' || source.type === 'pdf'
        ? (source.text ?? '')
        : null;

    if (text !== null) {
      const clean = sanitizeMaterialText(text);
      if (!hasUsableMaterial(clean)) {
        throw errors.validation('Add at least 20 readable characters of study material.');
      }
      // Duplicate guard: an accidental second import is worse than a strict check.
      const existing = await studyPackImportService.findExistingMaterial(db, userId, clean);
      if (existing && !input.allowDuplicate) {
        throw errors.conflict('This material may already exist in your study packs.', {
          reason: 'duplicate-source',
          packId: existing.packId,
          packTitle: existing.packTitle,
          sourceId: existing.sourceId,
          sourceTitle: existing.sourceTitle,
        });
      }
    }

    // One creation path for every source kind: pack first, then its source row.
    const pack = await studyPackService.create(db, userId, {
      title: input.title,
      subjectId: input.subjectId ?? null,
      description: input.description ?? '',
      level: input.level ?? '',
      visibility: 'private',
      examDate: input.examDate ?? null,
      ...(!uploaded && source.type === 'set'
        ? { source: { type: 'set' as const, setId: source.setId!, title: sourceTitle } }
        : !uploaded && (source.type === 'text' || source.type === 'pdf')
          ? {
              source: {
                type: source.type,
                title: sourceTitle,
                text: sanitizeMaterialText(text ?? ''),
                ...(source.type === 'pdf' && source.pageCount
                  ? { pageCount: source.pageCount }
                  : {}),
              },
            }
          : {}),
    });

    let created = (await db.packSources.listByPack(pack.id)).at(-1) ?? null;
    if (!created) {
      created = await db.packSources.create({
        packId: pack.id,
        ownerId: userId,
        kind: source.type === 'youtube' ? 'youtube' : source.type,
        title: sourceTitle,
        status: 'pending',
        content: null,
        characterCount: 0,
        pageCount: null,
        failureReason: null,
        legacySetId: null,
        origin: source.type === 'youtube' ? 'imported' : 'user',
        ...(source.type === 'youtube'
          ? {
              metadata: {
                ...EMPTY_SOURCE_METADATA,
                url: `https://www.youtube.com/watch?v=${parseYouTubeVideoId(source.url)}`,
                videoId: parseYouTubeVideoId(source.url),
              },
            }
          : {}),
      });
    }

    // File/YouTube sources keep their raw input in memory for the extraction
    // stage (and for a retry without re-uploading).
    if (uploaded) {
      pendingSourceInputs.set(created.id, {
        kind: source.type,
        buffer: source.file.buffer,
        filename: source.file.filename,
        mimeType: source.file.mimeType,
      });
      await db.packSources.update(created.id, { status: 'processing', processingStage: 'extract' });
    } else if (source.type === 'youtube') {
      pendingSourceInputs.set(created.id, {
        kind: 'youtube',
        url: source.url,
        transcript: source.transcript ?? null,
      });
      await db.packSources.update(created.id, { status: 'processing', processingStage: 'extract' });
    } else {
      await db.packSources.update(created.id, {
        status: 'processing',
        processingStage: 'extract',
      });
    }

    const job = importJobs.start({
      id: randomUUID(),
      packId: pack.id,
      userId,
      steps: PIPELINE_STAGES,
      aiAvailable: isAiConfigured(),
    });

    void runPipeline({
      db,
      userId,
      packId: pack.id,
      jobId: job.id,
      sourceId: created.id,
      settings: input.settings ?? null,
      startStage: 'extract',
    }).catch(() => {
      // runPipeline never throws by design; this is the last safety net so a
      // background failure cannot crash the process.
    });

    return { packId: pack.id, jobId: job.id };
  },

  /**
   * Adds one more source to an existing pack and processes it. Multi-source
   * packs are the normal case: the same pipeline runs, the analysis is redone
   * with every source, and provenance stays per source.
   */
  async addSourceFromUpload(
    db: Database,
    userId: string,
    packId: string,
    input: {
      kind: 'pdf' | 'powerpoint' | 'image' | 'audio';
      title?: string;
      file: { buffer: Buffer; filename: string; mimeType: string };
      settings?: Partial<GenerationSettings> | null;
    },
  ): Promise<ProcessingStatus> {
    const pack = await db.packs.get(packId);
    if (!pack || pack.ownerId !== userId) throw errors.notFound('Study pack not found');
    const running = importJobs.getByPack(packId);
    if (running && running.status === 'processing') {
      throw errors.rateLimited('Lerno is still working on this study pack. Try again in a moment.');
    }

    const title = (input.title ?? input.file.filename).trim().slice(0, 160) || 'Study material';
    const source = await db.packSources.create({
      packId,
      ownerId: userId,
      kind: input.kind,
      title,
      status: 'pending',
      content: null,
      characterCount: 0,
      pageCount: null,
      failureReason: null,
      legacySetId: null,
      origin: 'user',
    });
    pendingSourceInputs.set(source.id, {
      kind: input.kind,
      buffer: input.file.buffer,
      filename: input.file.filename,
      mimeType: input.file.mimeType,
    });

    return studyPackImportService.startProcessing(db, userId, packId, {
      sourceId: source.id,
      settings: input.settings ?? null,
    });
  },

  /** Adds a YouTube source (metadata + the student's own captions). */
  async addYouTubeSource(
    db: Database,
    userId: string,
    packId: string,
    input: { url: string; transcript?: string; title?: string; settings?: Partial<GenerationSettings> | null },
  ): Promise<ProcessingStatus> {
    const pack = await db.packs.get(packId);
    if (!pack || pack.ownerId !== userId) throw errors.notFound('Study pack not found');
    // Fail fast on a wrong link: the student gets the message immediately, not
    // five seconds later in a failed job.
    const videoId = parseYouTubeVideoId(input.url);
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    // Pasting the transcript after a failed first attempt re-uses the same
    // source row instead of adding a second one for the same video.
    const existing = (await db.packSources.listByPack(packId)).find(
      (source) =>
        source.kind === 'youtube' &&
        source.metadata?.videoId === videoId &&
        source.status !== 'ready',
    );
    const source =
      existing ??
      (await db.packSources.create({
        packId,
        ownerId: userId,
        kind: 'youtube',
        title: (input.title ?? 'YouTube lesson').slice(0, 160),
        status: 'pending',
        content: null,
        characterCount: 0,
        pageCount: null,
        failureReason: null,
        legacySetId: null,
        origin: 'imported',
        metadata: { ...EMPTY_SOURCE_METADATA, url, videoId },
      }));
    pendingSourceInputs.set(source.id, {
      kind: 'youtube',
      url,
      transcript: input.transcript ?? null,
    });
    return studyPackImportService.startProcessing(db, userId, packId, {
      sourceId: source.id,
      settings: input.settings ?? null,
    });
  },

  /**
   * The processing status of a pack: real stages while a job runs, and a
   * database-derived answer when no job exists (server restart, older import).
   */
  async status(db: Database, userId: string, packId: string): Promise<ProcessingStatus> {
    const pack = await db.packs.get(packId);
    if (!pack || pack.ownerId !== userId) throw errors.notFound('Study pack not found');

    const job = importJobs.getByPack(packId);
    const counts = await storedCounts(db, packId);
    const sources = await db.packSources.listByPack(packId);
    const characters = sources.reduce((total, source) => total + source.characterCount, 0);

    const estimate = estimateStudyTime({
      concepts: counts.concepts,
      flashcards: counts.flashcards,
      practiceQuestions: counts.practiceQuestions,
      sourceCharacters: characters,
      difficulty: pack.analysis?.difficulty ?? null,
    });

    const sourceViews: SourceStatusView[] = sources.map((source) => ({
      id: source.id,
      title: source.title,
      kind: source.kind,
      status: source.status,
      stage: source.processingStage,
      failureReason: source.failureReason,
      referenceLabel:
        source.metadata?.references?.[0]?.label ?? null,
      url: source.metadata?.url ?? null,
      /*
       * A text or set source can always be re-run from its stored content; a
       * file/YouTube source while its upload is still in memory (30 minutes);
       * and a YouTube source even after that, because the student can paste the
       * transcript again.
       */
      retryable:
        source.kind === 'text' ||
        source.kind === 'set' ||
        source.kind === 'youtube' ||
        (source.content ?? '').trim().length > 0 ||
        pendingSourceInputs.has(source.id),
    }));

    if (job) {
      const processing = job.status === 'processing';
      const steps = stepsFromJob(job);
      const stage = activeStage(steps);
      return {
        packId,
        status: processing ? 'processing' : job.status === 'partial' ? 'partial' : job.status,
        stage,
        stageLabel: stage ? IMPORT_STAGE_LABELS[stage] : null,
        steps,
        aiAvailable: job.aiAvailable,
        aiSkipped: job.aiSkipped,
        counts: { ...counts, ...job.counts, concepts: counts.concepts || job.counts.concepts },
        failure: job.failure
          ? { stage: job.failure.stage, message: job.failure.message, details: job.failure.details }
          : null,
        processing,
        sources: sourceViews,
        estimatedMinutes: estimate.minutes,
        estimatedStudyTimeLabel: estimate.label,
        ready: !processing && readableSources(sources) > 0,
      };
    }

    const failed = sources.find((source) => source.status === 'failed') ?? null;
    const processing = sources.some((source) => source.status === 'processing');
    const content = counts.concepts + counts.flashcards + counts.practiceQuestions > 0;
    const steps: ImportJobStepView[] = PIPELINE_STAGES.map((id) => ({
      id,
      label: IMPORT_STAGE_LABELS[id],
      state: processing
        ? ('pending' as const)
        : content
          ? ('done' as const)
          : failed
            ? ('failed' as const)
            : ('pending' as const),
    }));

    return {
      packId,
      status: processing ? 'processing' : failed && !content ? 'failed' : 'ready',
      stage: processing ? 'extract' : null,
      stageLabel: processing ? IMPORT_STAGE_LABELS.extract : null,
      steps,
      aiAvailable: isAiConfigured(),
      aiSkipped: false,
      counts,
      failure: failed
        ? {
            stage: failed.processingStage as ImportStageId | null,
            message: failed.failureReason ?? "We couldn't process this file.",
            details: `Source: ${failed.id} · Status: failed`,
          }
        : null,
      processing,
      sources: sourceViews,
      estimatedMinutes: estimate.minutes,
      estimatedStudyTimeLabel: estimate.label,
      ready: !processing && readableSources(sources) > 0,
    };
  },

  /**
   * Starts (or retries) the pipeline for material that is already stored — used
   * by "Try again", by "Retry extraction"/"Retry generation" and by
   * "Generate now" when AI was not configured during the first import.
   *
   * Retrying a later stage needs no upload at all. Retrying `extract` for a file
   * source works while the upload is still in memory (30 minutes, bounded); a
   * clear message asks for a new upload when it is not, and nothing else is lost.
   */
  async startProcessing(
    db: Database,
    userId: string,
    packId: string,
    options: {
      sourceId?: string | null;
      stage?: ImportStageId | null;
      settings?: Partial<GenerationSettings> | null;
    } = {},
  ): Promise<ProcessingStatus> {
    const pack = await db.packs.get(packId);
    if (!pack || pack.ownerId !== userId) throw errors.notFound('Study pack not found');
    const running = importJobs.getByPack(packId);
    if (running && running.status === 'processing') {
      return studyPackImportService.status(db, userId, packId);
    }

    const sources = await db.packSources.listByPack(packId);
    const usable = sources.filter(
      (source) => (source.content ?? '').trim().length > 0 || pendingSourceInputs.has(source.id),
    );
    const chosen = options.sourceId
      ? (sources.find((source) => source.id === options.sourceId) ?? null)
      : (usable.at(-1) ?? sources.at(-1) ?? null);
    if (!chosen) {
      throw errors.validation('Add readable material to this study pack first.');
    }
    return studyPackImportService.startProcessingInternal(db, userId, packId, chosen.id, {
      stage: options.stage ?? null,
      settings: options.settings ?? null,
    });
  },

  /** Internal entry point shared by imports, uploads and retries. */
  async startProcessingInternal(
    db: Database,
    userId: string,
    packId: string,
    sourceId: string,
    options: { stage?: ImportStageId | null; settings?: Partial<GenerationSettings> | null },
  ): Promise<ProcessingStatus> {
    if (importJobs.activeForUser(userId) >= MAX_ACTIVE_IMPORTS_PER_USER) {
      throw errors.rateLimited('Lerno is still working on other material. Try again in a moment.');
    }
    const source = await db.packSources.get(sourceId);
    if (!source || source.packId !== packId) throw errors.notFound('Source not found');

    // Resume where the source really is: retrying a later stage never needs an
    // upload, and a run that never analyzed (AI was down) starts at `analyze`.
    const pack = await db.packs.get(packId);
    const hasContent = (source.content ?? '').trim().length > 0;
    const hasAnalysis = Boolean(pack?.analysis);
    const failedStage: ImportStageId | null =
      source.status === 'failed' &&
      source.processingStage !== null &&
      source.processingStage !== 'upload'
        ? source.processingStage
        : null;
    /**
     * Resume rules:
     *  - nothing readable yet → read the material (upload/extract)
     *  - the last run failed in a later stage → retry exactly that stage
     *  - otherwise ("Generate now", a retry after AI was down, or an explicit
     *    re-run) → analyze + generate again; the quality pass keeps existing
     *    content and rejects duplicates, so nothing doubles up
     */
    const resumeStage: ImportStageId =
      !hasContent || (failedStage === 'extract' && !pendingSourceInputs.has(sourceId))
        ? 'extract'
        : failedStage && hasAnalysis && failedStage !== 'extract' && failedStage !== 'normalize'
          ? failedStage
          : 'analyze';
    const startStage: ImportStageId = options.stage ?? resumeStage;
    const needsUpload = startStage === 'extract' && !hasContent && !pendingSourceInputs.has(sourceId);

    if (needsUpload) {
      throw errors.validation(
        'Upload this file again to read it — your study pack and your other material are saved.',
      );
    }

    const job = importJobs.start({
      id: randomUUID(),
      packId,
      userId,
      steps: PIPELINE_STAGES.filter(
        (stage) => PIPELINE_STAGES.indexOf(stage) >= PIPELINE_STAGES.indexOf(startStage),
      ),
      aiAvailable: isAiConfigured(),
    });
    await db.packSources.update(sourceId, {
      status: 'processing',
      failureReason: null,
      processingStage: sourceStageFor(startStage),
    });

    // A retried generation must never duplicate existing content: the pipeline
    // passes the stored cards/questions/concepts into the quality check.
    void runPipeline({
      db,
      userId,
      packId,
      jobId: job.id,
      sourceId,
      settings: options.settings ?? null,
      startStage,
    }).catch(() => undefined);

    return studyPackImportService.status(db, userId, packId);
  },
};

function defaultSourceTitle(source: ImportSourceInput): string {
  if (source.type === 'set') return source.title?.trim() || 'Existing Lerno set';
  if (source.type === 'youtube') return source.title?.trim() || 'YouTube lesson';
  if (isUploadSource(source)) {
    return source.title.trim() || source.file.filename;
  }
  return source.title?.trim() || (source.type === 'pdf' ? 'PDF document' : 'Notes');
}

/* --------------------------------- pipeline -------------------------------- */

interface PipelineParams {
  db: Database;
  userId: string;
  packId: string;
  jobId: string;
  sourceId: string;
  settings: Partial<GenerationSettings> | null;
  startStage: ImportStageId;
}

/** Shared state of one run; never persisted, so nothing can leak between runs. */
interface RunState {
  extraction: ExtractionOutcome | null;
  normalized: NormalizedSource | null;
  analysis: SourceAnalysisResult | null;
  rejected: number;
  conflicts: number;
}

/**
 * The background pipeline. Every stage is independent: a failing stage stops the
 * rest of the AI work (no point hammering a broken provider) but never removes
 * what was already stored, and the study plan is always built because it is
 * deterministic and needs no AI.
 */
async function runPipeline(params: PipelineParams): Promise<void> {
  const { db, jobId, sourceId } = params;
  const deadline = Date.now() + IMPORT_DEADLINE_MS;
  const state: RunState = {
    extraction: null,
    normalized: null,
    analysis: null,
    rejected: 0,
    conflicts: 0,
  };
  let generated = false;

  const stages = PIPELINE_STAGES.filter(
    (stage) => PIPELINE_STAGES.indexOf(stage) >= PIPELINE_STAGES.indexOf(params.startStage),
  );

  try {
    for (const stage of stages) {
      const job = importJobs.get(jobId);
      if (!job) return;
      const step = job.steps.find((entry) => entry.id === stage);
      if (!step || step.state === 'skipped') continue;

      if (!isAiConfigured() && AI_STAGES.includes(stage)) {
        importJobs.update(jobId, {
          aiAvailable: false,
          aiSkipped: true,
          steps: importJobs
            .get(jobId)!
            .steps.map((entry) =>
              entry.id === stage ? { ...entry, state: 'skipped' as const } : entry,
            ),
        });
        continue;
      }

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
      await db.packSources
        .update(sourceId, { processingStage: sourceStageFor(stage) })
        .catch(() => undefined);
      try {
        const counts = await runStage(params, stage, state);
        if (counts) generated = true;
        importJobs.completeStage(jobId, stage, counts ?? {});
      } catch (error) {
        const failure = describeFailure(error, stage);
        if (failure.aiUnavailable) {
          // No AI configured / credentials rejected: keep the material and the
          // pack, skip the rest of the AI work.
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

    const finished = importJobs.get(jobId);
    if (finished && finished.status === 'processing') {
      importJobs.finish(jobId, {
        hasAnalysis: state.analysis !== null,
        conflicts: state.conflicts,
        rejected: state.rejected,
      });
    }
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

/** Runs one pipeline stage and reports what it produced. */
async function runStage(
  params: PipelineParams,
  stage: ImportStageId,
  state: RunState,
): Promise<Partial<ImportCounts> | null> {
  const { db, userId, packId, sourceId, settings } = params;

  if (stage === 'extract') {
    state.extraction = await runExtraction(db, sourceId);
    return null;
  }

  if (stage === 'normalize') {
    const source = await db.packSources.get(sourceId);
    if (!source) throw errors.notFound('Source not found');
    const outcome = state.extraction ?? rebuildExtractionOutcome(source);
    const normalized = buildNormalizedSource(source, outcome);
    if (!hasUsableMaterial(normalized.text)) {
      throw errors.validation(
        source.kind === 'image'
          ? "We couldn't detect enough text in this image. Try a sharper photo, crop out the background, or paste the text instead."
          : 'We could not read enough text from this source. Paste the text instead.',
      );
    }
    await db.packSources.update(sourceId, {
      content: normalized.text,
      characterCount: materialCharacterCount(normalized.text),
      pageCount: normalized.metadata.pageCount,
      status: 'processing',
      failureReason: null,
      processingStage: 'analyze',
      metadata: normalized.metadata,
    });
    state.normalized = normalized;
    return null;
  }

  if (stage === 'analyze') {
    const sources = await loadNormalizedSources(db, packId, state.normalized);
    const existingConcepts = await db.concepts.listByPack(packId);
    const settings_ = normalizeGenerationSettings(settings, sources.map((s) => s.language));
    const analysis = await analyzeSources(sources, {
      language: settings_.language,
      difficulty: settings_.difficulty,
      existingConceptNames: existingConcepts.map((concept) => concept.name),
    });
    state.analysis = analysis;
    state.rejected += analysis.rejected.length;
    state.conflicts += analysis.analysis.conflicts.length;
    await db.packs.update(packId, {
      analysis: analysis.analysis,
      analysisUpdatedAt: analysis.analysis.createdAt,
    });

    let summaryStored = false;
    if (analysis.analysis.summary.trim().length >= 30) {
      await studyPackService.applyContent(db, userId, packId, {
        target: 'summary',
        summary: analysis.analysis.summary.trim(),
        sourceId: analysis.analysis.sourceIds.length === 1 ? analysis.analysis.sourceIds[0]! : null,
      });
      summaryStored = true;
    }
    let conceptsStored = 0;
    if (analysis.concepts.length > 0) {
      const stored = await studyPackService.applyContent(db, userId, packId, {
        target: 'concepts',
        concepts: analysis.concepts.map((concept) => ({
          name: concept.name,
          explanation: concept.explanation,
          sourceId: concept.sourceId,
          refLabel: concept.refLabel,
          importance: concept.importance,
          difficulty: concept.difficulty,
        })),
        sourceId: analysis.analysis.sourceIds.length === 1 ? analysis.analysis.sourceIds[0]! : null,
      });
      conceptsStored = addedCount(stored) ?? analysis.concepts.length;
    }
    return { hasSummary: summaryStored, concepts: conceptsStored, hasAnalysis: true };
  }

  if (stage === 'generate') {
    const source = await db.packSources.get(sourceId);
    if (!source) throw errors.notFound('Source not found');
    const sources = await loadNormalizedSources(db, packId, state.normalized);
    const concepts = await db.concepts.listByPack(packId);
    const existing = await loadExistingContent(db, packId);
    const settings_ = normalizeGenerationSettings(settings, sources.map((s) => s.language));

    // Imported sets already hold the student's own flashcards: never pad them.
    const targets = source.kind === 'set' ? (['practice'] as const) : (['flashcards', 'practice'] as const);
    const bundle = await generateContent({
      sources,
      concepts,
      settings: settings_,
      existing,
      analysis: state.analysis?.analysis ?? null,
      targets: [...targets],
    });
    state.rejected += bundle.rejected.length;

    let flashcardsAdded = 0;
    if (bundle.flashcards.length > 0) {
      const stored = await studyPackService.applyContent(db, userId, packId, {
        target: 'flashcards',
        cards: bundle.flashcards.map((card) => ({
          front: card.front,
          back: card.back,
          sourceId: card.sourceId,
          conceptId: card.conceptId,
        })),
        sourceId: sourceId,
      });
      flashcardsAdded = addedCount(stored) ?? bundle.flashcards.length;
    }

    let questionsAdded = 0;
    if (bundle.questions.length > 0) {
      const stored = await studyPackService.applyContent(db, userId, packId, {
        target: 'practice',
        questions: bundle.questions.map((question) => ({
          questionType: question.questionType,
          prompt: question.prompt,
          correctAnswer: question.correctAnswer,
          options: question.options,
          explanation: question.explanation,
          sourceId: question.sourceId,
          conceptId: question.conceptId,
        })),
        sourceId: sourceId,
      });
      questionsAdded = addedCount(stored) ?? bundle.questions.length;
    }
    return { flashcards: flashcardsAdded, practiceQuestions: questionsAdded };
  }

  if (stage === 'review') {
    // Defensive final check on what is really stored (a retry can add content
    // twice if a card slipped through, and that must be caught here).
    const duplicates = await countDuplicates(db, packId);
    const stored = await storedCounts(db, packId);
    if (duplicates > 0) {
      state.rejected += duplicates;
    }
    return {
      concepts: stored.concepts,
      flashcards: stored.flashcards,
      practiceQuestions: stored.practiceQuestions,
      hasSummary: stored.hasSummary,
      hasAnalysis: stored.hasAnalysis,
      conflicts: state.conflicts,
      rejected: state.rejected,
    };
  }

  // Deterministic study plan: built from the pack's real counts, no AI.
  await studyPackService.createPlan(db, userId, packId, { minutesPerDay: 30 });
  return { hasPlan: true };
}

/* ------------------------------- stage helpers ----------------------------- */

/** Runs the extractor for one source row. */
async function runExtraction(db: Database, sourceId: string): Promise<ExtractionOutcome> {
  const source = await db.packSources.get(sourceId);
  if (!source) throw errors.notFound('Source not found');
  const pending: PendingSourceInput | null = pendingSourceInputs.get(sourceId);
  const storedText = source.content ?? '';

  if (source.kind === 'text' || source.kind === 'set') {
    return extractSource({ kind: source.kind, text: storedText });
  }

  // Material that was already extracted stays readable without any upload: a
  // retry of a later stage (or a re-run of the whole pipeline) must never ask
  // the student to send the same file twice.
  if (!pending) {
    if (storedText.trim().length > 0) return rebuildExtractionOutcome(source);
    throw errors.validation(
      source.kind === 'youtube'
        ? 'Paste the transcript again to read this video — your study pack is saved.'
        : 'Upload this file again to read it — your study pack and your other material are saved.',
    );
  }

  if (pending.kind === 'youtube') {
    if (source.kind === 'youtube') {
      return extractSource({ kind: 'youtube', url: pending.url, transcript: pending.transcript });
    }
    throw errors.validation('Upload this file again to read it — your study pack is saved.');
  }
  if (source.kind === 'youtube') {
    throw errors.validation('Paste the transcript again to read this video — your study pack is saved.');
  }
  return extractSource({
    kind: source.kind,
    buffer: pending.buffer,
    filename: pending.filename,
    mimeType: pending.mimeType,
  });
}

/**
 * Rebuilds an extraction outcome from stored content (no upload needed).
 *
 * Used when a later stage is retried or re-run: the source already has its text,
 * its references and its metadata, and none of that may be lost — the stored
 * provenance is carried forward instead of being re-derived from scratch.
 */
function rebuildExtractionOutcome(source: StudyPackSourceRecord): ExtractionOutcome {
  const text = source.content ?? '';
  const metadata = source.metadata;
  return {
    chunks: [{ text }],
    referenceKind: metadata?.referenceKind ?? 'none',
    extractedBy: metadata?.extractedBy ?? 'user',
    pageCount: source.pageCount ?? metadata?.pageCount ?? null,
    slideCount: metadata?.slideCount ?? null,
    durationSeconds: metadata?.durationSeconds ?? null,
    channel: metadata?.channel ?? null,
    url: metadata?.url ?? null,
    videoId: metadata?.videoId ?? null,
    warnings: metadata?.warnings ?? [],
    sections: metadata?.sections ?? [],
  };
}

/** Normalizes an extractor outcome into the one internal source shape. */
function buildNormalizedSource(
  source: {
    id: string;
    title: string;
    kind: NormalizedSource['kind'];
    metadata: NormalizedSource['metadata'];
  },
  outcome: ExtractionOutcome,
): NormalizedSource {
  const normalized = normalizeChunks(outcome.chunks, {
    kind: source.kind,
    referenceKind: outcome.referenceKind,
  });
  const stored = source.metadata;
  const outcomeSections =
    outcome.sections.length > 0
      ? outcome.sections
      : normalized.references.length > 0
        ? []
        : detectTextSections(normalized.text);
  // Re-running normalization must never throw away provenance that is already
  // stored (a PDF's page references, a recording's transcript timestamps).
  const sections = outcomeSections.length > 0 ? outcomeSections : (stored?.sections ?? []);
  const references =
    normalized.references.length > 0
      ? normalized.references
      : sections.length > 0 && (stored?.references?.length ?? 0) === 0
        ? sections.map((section) => ({
            marker: section.marker,
            kind: 'section' as const,
            label: section.title,
            start: section.start,
          }))
        : (stored?.references ?? []);

  const metadata = {
    ...stored,
    referenceKind:
      references.length > 0 ? (references[0]!.kind as SourceReferenceKind) : outcome.referenceKind,
    extractedBy:
      normalized.references.length > 0 || outcomeSections.length > 0
        ? outcome.extractedBy
        : (stored?.extractedBy ?? outcome.extractedBy),
    references,
    sections,
    pageCount: outcome.pageCount ?? stored?.pageCount ?? null,
    slideCount: outcome.slideCount ?? stored?.slideCount ?? null,
    durationSeconds: outcome.durationSeconds ?? stored?.durationSeconds ?? null,
    channel: outcome.channel ?? stored?.channel ?? null,
    url: outcome.url ?? stored?.url ?? null,
    videoId: outcome.videoId ?? stored?.videoId ?? null,
    warnings: outcome.warnings.length > 0 ? outcome.warnings : (stored?.warnings ?? []),
    language: stored?.language ?? 'unknown',
  } as NormalizedSource['metadata'];

  return {
    sourceId: source.id,
    title: source.title,
    kind: source.kind,
    language: metadata.language,
    text: normalized.text,
    sections: metadata.sections,
    references: metadata.references,
    metadata,
  };
}

/** All readable sources of the pack, as normalized sources. */
async function loadNormalizedSources(
  db: Database,
  packId: string,
  fresh: NormalizedSource | null,
): Promise<NormalizedSource[]> {
  const rows = await db.packSources.listByPack(packId);
  return rows
    .filter((row) => row.status !== 'failed' && (row.content ?? '').trim().length > 0)
    .map((row) => (fresh && row.id === fresh.sourceId ? fresh : toNormalizedSource(row)));
}

/** Existing pack content, so generation never duplicates what is already there. */
async function loadExistingContent(
  db: Database,
  packId: string,
): Promise<{ cardFronts: string[]; questionPrompts: string[]; conceptNames: string[] }> {
  const pack = await db.packs.get(packId);
  const [questions, concepts] = await Promise.all([
    db.practiceQuestions.listByPack(packId),
    db.concepts.listByPack(packId),
  ]);
  const cards = pack?.legacySetId ? await db.cards.listBySet(pack.legacySetId) : [];
  return {
    cardFronts: cards.map((card) => card.question),
    questionPrompts: questions.map((question) => question.prompt),
    conceptNames: concepts.map((concept) => concept.name),
  };
}

/** Number of duplicate cards/questions currently stored (should always be 0). */
async function countDuplicates(db: Database, packId: string): Promise<number> {
  const { cardFronts, questionPrompts } = await loadExistingContent(db, packId);
  const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const duplicateCards = cardFronts.length - new Set(cardFronts.map(normalize)).size;
  const duplicateQuestions = questionPrompts.length - new Set(questionPrompts.map(normalize)).size;
  return duplicateCards + duplicateQuestions;
}

export type { ConceptRecord, PracticeQuestionRecord, GenerationLanguage };
