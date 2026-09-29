/**
 * Multipart upload handling for Study Pack sources (PDF, PowerPoint, image,
 * audio) — one handler, one place where upload safety is enforced.
 *
 * Security rules (kept identical to the existing PDF upload):
 *  - in-memory only: no filename ever touches the filesystem, so path traversal
 *    and temp-file cleanup are impossible by construction
 *  - one file, one field, a hard byte limit per source kind
 *  - the declared kind, the declared MIME type and the file extension are checked
 *    after parsing; the real signature (and the parsing limits) are enforced
 *    during extraction, so a renamed file cannot pass as another kind
 *  - upload failures return safe messages only
 *
 * The multipart body can only be trusted once it is parsed, so the parser uses
 * the largest ceiling and the exact per-kind limit is checked immediately after —
 * that is what makes PowerPoint, image and audio uploads work through the same
 * endpoint as PDFs without a second upload path.
 */
import multer, { MulterError } from 'multer';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from '../config.js';
import { errors } from '../lib/errors.js';
import { allowedMimeTypes, assertSourceExtension, type FileSourceKind } from '../services/source-extract.js';

const FILE_KINDS = ['pdf', 'powerpoint', 'image', 'audio'] as const;

/**
 * Fallbacks for the per-kind ceilings. They are only used when a partial test
 * configuration does not define them, so importing this module never fails.
 */
const DEFAULT_LIMIT_BYTES: Record<FileSourceKind, number> = {
  pdf: 15 * 1024 * 1024,
  powerpoint: 25 * 1024 * 1024,
  image: 10 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
};

function limitOrFallback(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Byte ceiling per kind — the same numbers the extractors enforce. */
export function uploadLimitBytes(kind: FileSourceKind): number {
  switch (kind) {
    case 'pdf':
      return limitOrFallback(config.sourceMaxPdfBytes, DEFAULT_LIMIT_BYTES.pdf);
    case 'powerpoint':
      return limitOrFallback(config.sourceMaxPptxBytes, DEFAULT_LIMIT_BYTES.powerpoint);
    case 'image':
      return limitOrFallback(config.sourceMaxImageBytes, DEFAULT_LIMIT_BYTES.image);
    case 'audio':
      return limitOrFallback(config.sourceMaxAudioBytes, DEFAULT_LIMIT_BYTES.audio);
  }
}

/** Human-readable size used in validation messages. */
export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Human-readable limit used in validation messages. */
export function uploadLimitLabel(kind: FileSourceKind): string {
  return formatMegabytes(uploadLimitBytes(kind));
}

/** The largest limit any kind has; the parser aborts above it. */
export const MAX_UPLOAD_BYTES = Math.max(
  ...FILE_KINDS.map((kind) => uploadLimitBytes(kind)),
);

/** The kind an upload declares; anything else is not a file source at all. */
export function declaredSourceKind(value: unknown): FileSourceKind | null {
  return typeof value === 'string' && (FILE_KINDS as readonly string[]).includes(value)
    ? (value as FileSourceKind)
    : null;
}

/** Validates the declared type/extension of an uploaded source file. */
export function assertUploadedSource(
  expected: FileSourceKind,
  file: Express.Multer.File | undefined,
  declaredKind?: unknown,
): void {
  if (!file) throw errors.validation('Choose a file to upload.');
  if (typeof declaredKind === 'string' && declaredKind && declaredKind !== expected) {
    throw errors.validation('That file type does not match the source you are adding.');
  }
  const allowed = allowedMimeTypes(expected);
  if (file.mimetype && !allowed.includes(file.mimetype)) {
    throw errors.validation(`That file type is not supported for ${expected} sources.`);
  }
  assertSourceExtension(expected, file.originalname ?? '');
}

/** The real byte limit of the kind the student chose (multer only caps the max). */
export function assertUploadedSize(
  kind: FileSourceKind,
  file: Express.Multer.File | undefined,
): void {
  if (!file) throw errors.validation('Choose a file to upload.');
  if (file.size > uploadLimitBytes(kind)) {
    throw errors.validation(
      `This file is too large. The limit for ${kind} files is ${uploadLimitLabel(kind)}.`,
    );
  }
}

const parser = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 12,
    fieldNameSize: 40,
    fieldSize: 60_000, // a pasted YouTube transcript is a field, not a file
  },
}).single('file');

let cachedHandler: RequestHandler | null = null;

/**
 * Parses one source upload and validates it against the kind the upload declares.
 * Used by both import endpoints, so there is exactly one upload path.
 */
export function handleSourceUpload(): RequestHandler {
  if (cachedHandler) return cachedHandler;

  cachedHandler = (req: Request, res: Response, next: NextFunction) => {
    parser(req, res, (error: unknown) => {
      const kind = declaredSourceKind(req.body?.kind);
      if (error) {
        if (error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE') {
          next(
            errors.validation(
              kind
                ? `This file is too large. The limit for ${kind} files is ${uploadLimitLabel(kind)}.`
                : `This file is too large. The limit is ${formatMegabytes(MAX_UPLOAD_BYTES)}.`,
            ),
          );
          return;
        }
        next(errors.validation('That upload could not be processed. Choose one file and try again.'));
        return;
      }
      try {
        if (!kind) throw errors.validation('That file type does not match the source you are adding.');
        assertUploadedSource(kind, req.file, kind);
        assertUploadedSize(kind, req.file);
        next();
      } catch (validationError) {
        next(validationError);
      }
    });
  };

  return cachedHandler;
}
