/**
 * Import job store — the real, short-lived progress state of one material
 * import, so the UI can show actual stages instead of fake progress.
 *
 * Scope and safety rules:
 *  - In-memory and bounded (max entries, TTL). A job is only progress
 *    bookkeeping: the Study Pack, its sources and its content are always
 *    written to the database first, so losing a job can never lose study
 *    material. If a job is gone, the API derives the status from the database.
 *  - One active job per Study Pack; a finished job is replaced by the next run.
 */

/**
 * Real stages of turning material into a study pack — one pipeline for every
 * source kind:
 *
 *   extract → normalize → analyze → generate → review → plan
 *
 * `extract`/`normalize` are honest no-ops for pasted text (the text is already
 * there) but they still run, so a PDF, a presentation, a photo, a recording and a
 * YouTube lesson all follow exactly the same path and report the same stages.
 */
export type ImportStageId =
  | 'extract'
  | 'normalize'
  | 'analyze'
  | 'generate'
  | 'review'
  | 'plan';

export type ImportStepState = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export interface ImportJobStep {
  id: ImportStageId;
  state: ImportStepState;
}

export interface ImportFailure {
  /** Stage that failed, or null when the failure is not stage-specific. */
  stage: ImportStageId | null;
  /** User-facing, safe message (no upstream detail). */
  message: string;
  /** Technical detail, only rendered behind an expandable "Details". */
  details: string | null;
}

export interface ImportCounts {
  /** Sources in the pack, and how many are ready to study from. */
  sources: number;
  readySources: number;
  concepts: number;
  flashcards: number;
  practiceQuestions: number;
  hasSummary: boolean;
  hasPlan: boolean;
  /** True once the source-grounded analysis exists on the pack. */
  hasAnalysis: boolean;
  /** Conflicts between sources that the student must resolve. */
  conflicts: number;
  /** Generated items the quality pass rejected (never shown to the student). */
  rejected: number;
}

export type ImportJobStatus = 'processing' | 'ready' | 'partial' | 'failed';

export interface ImportJob {
  id: string;
  packId: string;
  userId: string;
  steps: ImportJobStep[];
  status: ImportJobStatus;
  /** False when Lerno AI is not configured — material is still stored. */
  aiAvailable: boolean;
  /** True when AI steps were skipped because the AI is unavailable. */
  aiSkipped: boolean;
  counts: ImportCounts;
  failure: ImportFailure | null;
  startedAt: string;
  updatedAt: string;
}

const MAX_JOBS = 400;
const JOB_TTL_MS = 30 * 60 * 1000;

const jobs = new Map<string, ImportJob>();

function now(): string {
  return new Date().toISOString();
}

function sweep(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of [...jobs]) {
    if (Date.parse(job.updatedAt) < cutoff) jobs.delete(id);
  }
  while (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
    if (!oldest) break;
    jobs.delete(oldest.id);
  }
}

export const importJobs = {
  /** Starts (or replaces) the job of a pack. */
  start(input: {
    id: string;
    packId: string;
    userId: string;
    steps: ImportStageId[];
    aiAvailable: boolean;
  }): ImportJob {
    sweep();
    for (const [id, job] of [...jobs]) {
      if (job.packId === input.packId) jobs.delete(id);
    }
    const job: ImportJob = {
      id: input.id,
      packId: input.packId,
      userId: input.userId,
      steps: input.steps.map((id) => ({ id, state: 'pending' as const })),
      status: 'processing',
      aiAvailable: input.aiAvailable,
      aiSkipped: false,
      counts: {
        sources: 0,
        readySources: 0,
        concepts: 0,
        flashcards: 0,
        practiceQuestions: 0,
        hasSummary: false,
        hasPlan: false,
        hasAnalysis: false,
        conflicts: 0,
        rejected: 0,
      },
      failure: null,
      startedAt: now(),
      updatedAt: now(),
    };
    jobs.set(job.id, job);
    return job;
  },

  get(id: string): ImportJob | null {
    return jobs.get(id) ?? null;
  },

  getByPack(packId: string): ImportJob | null {
    return [...jobs.values()].find((job) => job.packId === packId) ?? null;
  },

  /** Number of imports this user still has running (burst protection). */
  activeForUser(userId: string): number {
    return [...jobs.values()].filter((job) => job.userId === userId && job.status === 'processing')
      .length;
  },

  update(jobId: string, patch: Partial<Omit<ImportJob, 'id' | 'packId' | 'userId'>>): ImportJob {
    const current = jobs.get(jobId);
    if (!current) throw new Error('Import job not found');
    const next: ImportJob = { ...current, ...patch, updatedAt: now() };
    jobs.set(jobId, next);
    return next;
  },

  /** Moves one stage forward: previous stage done, this one active. */
  enterStage(jobId: string, stage: ImportStageId): ImportJob {
    const current = jobs.get(jobId);
    if (!current) throw new Error('Import job not found');
    const index = current.steps.findIndex((step) => step.id === stage);
    const steps = current.steps.map((step, position) => {
      // Steps that were skipped on purpose (no AI configured) stay skipped.
      if (position < index) {
        return step.state === 'skipped' || step.state === 'failed'
          ? step
          : { ...step, state: 'done' as const };
      }
      if (position === index) return { ...step, state: 'active' as const };
      return step;
    });
    return importJobs.update(jobId, { steps, status: 'processing' });
  },

  /** Marks a stage done and adds what it produced. */
  completeStage(jobId: string, stage: ImportStageId, counts: Partial<ImportCounts>): ImportJob {
    const current = jobs.get(jobId);
    if (!current) throw new Error('Import job not found');
    return importJobs.update(jobId, {
      steps: current.steps.map((step) =>
        step.id === stage ? { ...step, state: 'done' as const } : step,
      ),
      counts: { ...current.counts, ...counts },
    });
  },

  fail(
    jobId: string,
    failure: ImportFailure,
    options: { status: ImportJobStatus; skipRemainingAi: boolean },
  ): ImportJob {
    const current = jobs.get(jobId);
    if (!current) throw new Error('Import job not found');
    const failedIndex = failure.stage
      ? current.steps.findIndex((step) => step.id === failure.stage)
      : -1;
    const steps = current.steps.map((step, position) => {
      if (position === failedIndex) return { ...step, state: 'failed' as const };
      if (options.skipRemainingAi && position > failedIndex && step.state !== 'done') {
        return { ...step, state: 'skipped' as const };
      }
      return step;
    });
    return importJobs.update(jobId, {
      steps,
      failure,
      status: options.status,
      aiSkipped: options.skipRemainingAi,
    });
  },

  finish(jobId: string, counts: Partial<ImportCounts>): ImportJob {
    const current = jobs.get(jobId);
    if (!current) throw new Error('Import job not found');
    return importJobs.update(jobId, {
      steps: current.steps.map((step) =>
        step.state === 'done' || step.state === 'skipped'
          ? step
          : { ...step, state: 'skipped' as const },
      ),
      counts: { ...current.counts, ...counts },
      status: 'ready',
    });
  },

  /** Test helper: drops every job (real jobs are process-local anyway). */
  clear(): void {
    jobs.clear();
  },
};

export type { ImportJob as ImportJobRecord };
