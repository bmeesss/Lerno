import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { errors } from '../lib/errors.js';
import { studyPackService } from '../services/study-pack-service.js';
import { studyPackGenerationService } from '../services/study-pack-generation.js';
import { studyPackImportService } from '../services/study-pack-import.js';
import { assertPdfMimeType } from '../middleware/pdf-upload.js';
import type {
  AddSourceBody,
  ApplyContentBody,
  CreatePackBody,
  CreateTestBody,
  GenerateBody,
  ImportPackBody,
  ProcessPackBody,
  SubmitTestBody,
  TutorBody,
  UpdatePackBody,
} from '../validators/study-pack.validators.js';
import type { ConceptRating } from '../services/study-pack-rules.js';

/**
 * Study Pack endpoints. Authorization lives in the service layer (owner-only
 * writes, owner-or-public reads); controllers only translate HTTP ↔ service.
 */
export const studyPackController = {
  /* ---------------------------------- packs -------------------------------- */

  list: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    sendOk(res, await studyPackService.list(req.db, req.auth.id));
  }),

  today: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    sendOk(res, await studyPackService.today(req.db, req.auth.id));
  }),

  reviewQueue: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    sendOk(res, await studyPackService.reviewSummary(req.db, req.auth.id));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const body = req.body as CreatePackBody;
    sendOk(res, await studyPackService.create(req.db, req.auth.id, body), 201);
  }),

  detail: asyncHandler(async (req: Request, res: Response) => {
    const { packId } = req.params as { packId: string };
    sendOk(res, await studyPackService.detail(req.db, req.auth?.id ?? null, packId));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId } = req.params as { packId: string };
    sendOk(
      res,
      await studyPackService.update(req.db, req.auth.id, packId, req.body as UpdatePackBody),
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId } = req.params as { packId: string };
    await studyPackService.remove(req.db, req.auth.id, packId);
    res.status(204).end();
  }),

  /* ------------------------------ import flow ------------------------------ */

  /**
   * Reads an uploaded PDF and answers with what Lerno found (pages, words,
   * concept candidates). Nothing is stored: the student confirms first.
   */
  importPdfPreview: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    assertPdfMimeType(req.file);
    const filename =
      req.file?.originalname?.trim() ||
      (typeof req.body?.title === 'string' ? req.body.title : 'document.pdf');
    sendOk(res, await studyPackImportService.previewPdf(req.file!.buffer, filename), 201);
  }),

  /** Creates the pack with its source and starts the real processing pipeline. */
  importPack: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const started = await studyPackImportService.startImport(
      req.db,
      req.auth.id,
      req.body as ImportPackBody,
    );
    sendOk(
      res,
      {
        packId: started.packId,
        jobId: started.jobId,
        status: await studyPackImportService.status(req.db, req.auth.id, started.packId),
      },
      201,
    );
  }),

  /** Real, per-stage processing status of a study pack (owner only). */
  processingStatus: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId } = req.params as { packId: string };
    sendOk(res, await studyPackImportService.status(req.db, req.auth.id, packId));
  }),

  /** Starts or retries generation for material that is already stored. */
  processPack: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId } = req.params as { packId: string };
    const body = req.body as ProcessPackBody;
    sendOk(
      res,
      await studyPackImportService.startProcessing(req.db, req.auth.id, packId, {
        sourceId: body.sourceId ?? null,
      }),
      202,
    );
  }),

  /* -------------------------------- sources -------------------------------- */

  listSources: asyncHandler(async (req: Request, res: Response) => {
    const { packId } = req.params as { packId: string };
    sendOk(res, await studyPackService.listSources(req.db, req.auth?.id ?? null, packId));
  }),

  addSource: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId } = req.params as { packId: string };
    const body = req.body as AddSourceBody;
    sendOk(
      res,
      await studyPackService.addSource(req.db, req.auth.id, packId, {
        type: body.type,
        title: body.title ?? (body.type === 'set' ? 'Existing study set' : 'Study material'),
        ...(body.type === 'set' ? { setId: body.setId } : { text: body.text }),
        ...(body.type === 'pdf' ? { pageCount: body.pageCount } : {}),
      }),
      201,
    );
  }),

  removeSource: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId, sourceId } = req.params as { packId: string; sourceId: string };
    await studyPackService.removeSource(req.db, req.auth.id, packId, sourceId);
    res.status(204).end();
  }),

  /* -------------------------------- concepts ------------------------------- */

  createConcept: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId } = req.params as { packId: string };
    sendOk(res, await studyPackService.createConcept(req.db, req.auth.id, packId, req.body), 201);
  }),

  updateConcept: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId, conceptId } = req.params as { packId: string; conceptId: string };
    sendOk(
      res,
      await studyPackService.updateConcept(req.db, req.auth.id, packId, conceptId, req.body),
    );
  }),

  removeConcept: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId, conceptId } = req.params as { packId: string; conceptId: string };
    await studyPackService.removeConcept(req.db, req.auth.id, packId, conceptId);
    res.status(204).end();
  }),

  rateConcept: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId, conceptId } = req.params as { packId: string; conceptId: string };
    const { rating, responseTimeMs } = req.body as {
      rating: ConceptRating;
      responseTimeMs?: number;
    };
    sendOk(
      res,
      await studyPackService.rateConcept(req.db, req.auth.id, packId, conceptId, rating, responseTimeMs),
    );
  }),

  /* ------------------------- generation + content -------------------------- */

  generate: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId } = req.params as { packId: string };
    sendOk(
      res,
      await studyPackGenerationService.generate(
        req.db,
        req.auth.id,
        packId,
        req.body as GenerateBody,
      ),
    );
  }),

  applyContent: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId } = req.params as { packId: string };
    sendOk(
      res,
      await studyPackService.applyContent(
        req.db,
        req.auth.id,
        packId,
        req.body as ApplyContentBody,
      ),
      201,
    );
  }),

  /* -------------------------------- practice ------------------------------- */

  practiceQueue: asyncHandler(async (req: Request, res: Response) => {
    const { packId } = req.params as { packId: string };
    const query = req.query as { conceptId?: string; limit?: number };
    sendOk(
      res,
      await studyPackService.practiceQueue(req.db, req.auth?.id ?? null, packId, {
        conceptId: query.conceptId,
        limit: query.limit,
      }),
    );
  }),

  learnNext: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId } = req.params as { packId: string };
    const query = req.query as { exclude?: string[]; focusConceptId?: string };
    sendOk(
      res,
      await studyPackService.nextLearnConcept(
        req.db,
        req.auth.id,
        packId,
        query.exclude ?? [],
        query.focusConceptId,
      ),
    );
  }),

  practiceAttempt: asyncHandler(async (req: Request, res: Response) => {
    const { packId } = req.params as { packId: string };
    const body = req.body as { questionId: string; answer: string; responseTimeMs?: number };
    sendOk(res, await studyPackService.gradePractice(req.db, req.auth?.id ?? null, packId, body));
  }),

  /* ---------------------------------- tests -------------------------------- */

  listTests: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId } = req.params as { packId: string };
    sendOk(res, await studyPackService.listTests(req.db, req.auth.id, packId));
  }),

  createTest: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId } = req.params as { packId: string };
    sendOk(
      res,
      await studyPackService.createTest(req.db, req.auth.id, packId, req.body as CreateTestBody),
      201,
    );
  }),

  submitTest: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId, testId } = req.params as { packId: string; testId: string };
    sendOk(
      res,
      await studyPackService.submitTest(
        req.db,
        req.auth.id,
        packId,
        testId,
        req.body as SubmitTestBody,
      ),
    );
  }),

  /* -------------------------------- progress ------------------------------- */

  progress: asyncHandler(async (req: Request, res: Response) => {
    const { packId } = req.params as { packId: string };
    sendOk(res, await studyPackService.progressOverview(req.db, req.auth?.id ?? null, packId));
  }),

  /* ---------------------------------- plan --------------------------------- */

  getPlan: asyncHandler(async (req: Request, res: Response) => {
    const { packId } = req.params as { packId: string };
    sendOk(res, await studyPackService.getPlan(req.db, req.auth?.id ?? null, packId));
  }),

  createPlan: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId } = req.params as { packId: string };
    const body = req.body as { days?: number; minutesPerDay?: number };
    sendOk(res, await studyPackService.createPlan(req.db, req.auth.id, packId, body), 201);
  }),

  /* ---------------------------------- tutor -------------------------------- */

  tutor: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { packId } = req.params as { packId: string };
    sendOk(
      res,
      await studyPackGenerationService.tutor(req.db, req.auth.id, packId, req.body as TutorBody),
    );
  }),
};
