/**
 * Multipart PDF upload handling, shared by the AI Studio source panel and the
 * Study Pack importer.
 *
 * Security rules (spec §18):
 *  - in-memory only: no filename ever touches the filesystem
 *  - one file, one field, hard byte limit (`MAX_STUDIO_PDF_BYTES`)
 *  - the declared MIME type is checked here; the real `%PDF-` signature is
 *    verified during extraction, so a renamed file cannot pass as a PDF
 */
import multer, { MulterError } from 'multer';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { errors } from '../lib/errors.js';
import { MAX_STUDIO_PDF_BYTES } from '../services/ai-studio-pdf.js';

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_STUDIO_PDF_BYTES,
    files: 1,
    fields: 2,
    fieldNameSize: 40,
    fieldSize: 256,
  },
}).single('file');

/** MIME types browsers send for PDFs (and the generic fallback some send). */
const PDF_MIME_TYPES = ['application/pdf', 'application/x-pdf', 'application/octet-stream'];

/** Validates the declared type of an uploaded file. */
export function assertPdfMimeType(file: Express.Multer.File | undefined): void {
  if (!file) throw errors.validation('Choose a PDF file to upload.');
  if (file.mimetype && !PDF_MIME_TYPES.includes(file.mimetype)) {
    throw errors.validation('That file type is not supported. Choose a PDF document.');
  }
}

export const handlePdfUpload: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  pdfUpload(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(errors.validation('PDFs must be 15 MB or smaller.'));
      return;
    }
    next(errors.validation('The PDF upload could not be processed. Choose one PDF and try again.'));
  });
};
