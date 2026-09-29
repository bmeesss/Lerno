import { api, apiUploadWithProgress, type UploadOptions } from '../lib/api';
import type {
  ImportProcessingStatus,
  ImportStarted,
  MaterialPdfPreview,
} from '../types';

/**
 * Turning material into a study pack: one service for the whole flow so no
 * component ever talks to the API directly.
 *
 *  - `previewPdf` reads a PDF and reports what Lerno really found (nothing is
 *    stored yet, so a wrong file costs nothing)
 *  - `create` stores the pack + source and starts real processing
 *  - `status` reports the true per-stage state while Lerno works
 *  - `process` retries or starts generation for material that is already stored
 */

export interface ImportSourceInput {
  type: 'text' | 'pdf' | 'set';
  title: string;
  text?: string;
  pageCount?: number;
  setId?: string;
}

export interface ImportPackInput {
  title: string;
  subjectId?: string | null;
  level?: string;
  description?: string;
  examDate?: string | null;
  source: ImportSourceInput;
  /** True after the student saw the duplicate warning and chose to continue. */
  allowDuplicate?: boolean;
}

export const studyPackImportService = {
  previewPdf: (file: File, options: UploadOptions = {}) => {
    const body = new FormData();
    body.append('file', file);
    body.append('title', file.name);
    return apiUploadWithProgress<MaterialPdfPreview>(
      '/study-packs/import/pdf',
      body,
      options,
    );
  },

  create: (input: ImportPackInput) => api.post<ImportStarted>('/study-packs/import', input),

  status: (packId: string) =>
    api.get<ImportProcessingStatus>(`/study-packs/${packId}/processing`),

  process: (packId: string, sourceId?: string | null) =>
    api.post<ImportProcessingStatus>(`/study-packs/${packId}/process`, {
      sourceId: sourceId ?? null,
    }),
};
