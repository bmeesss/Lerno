import { api, apiUploadWithProgress, type UploadOptions } from '../lib/api';
import type {
  GenerationSettings,
  ImportProcessingStatus,
  ImportStarted,
  MaterialPdfPreview,
  PackSourceKind,
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
  type: 'text' | 'pdf' | 'set' | 'youtube';
  title: string;
  text?: string;
  pageCount?: number;
  setId?: string;
  url?: string;
  transcript?: string;
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
  settings?: Partial<GenerationSettings>;
}

/** A file the student picked; the backend reads it, the browser never does. */
export interface UploadSourceInput {
  kind: Extract<PackSourceKind, 'pdf' | 'powerpoint' | 'image' | 'audio'>;
  file: File;
  title?: string;
  subjectId?: string | null;
  level?: string;
  description?: string;
  examDate?: string | null;
  allowDuplicate?: boolean;
  settings?: Partial<GenerationSettings>;
}

function settingsFields(body: FormData, settings: Partial<GenerationSettings> | undefined): void {
  if (!settings) return;
  if (settings.flashcards) body.append('flashcards', String(settings.flashcards));
  if (settings.practice) body.append('practice', String(settings.practice));
  if (settings.difficulty) body.append('difficulty', settings.difficulty);
  if (settings.language) body.append('language', settings.language);
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

  /**
   * Creates a pack from an uploaded file. The backend extracts the text itself
   * (PDF text, PPTX slides, image OCR, audio transcription), so the progress
   * here is a real upload and the stages that follow are real too.
   */
  createFromUpload: (input: UploadSourceInput, options: UploadOptions = {}) => {
    const body = new FormData();
    body.append('kind', input.kind);
    body.append('file', input.file);
    body.append('title', input.title?.trim() || input.file.name);
    if (input.subjectId) body.append('subjectId', input.subjectId);
    if (input.level) body.append('level', input.level);
    if (input.description) body.append('description', input.description);
    if (input.examDate) body.append('examDate', input.examDate);
    if (input.allowDuplicate) body.append('allowDuplicate', 'true');
    settingsFields(body, input.settings);
    return apiUploadWithProgress<ImportStarted>('/study-packs/import/upload', body, options);
  },

  /** Adds one uploaded file (PDF/PPTX/image/audio) to a pack that already exists. */
  uploadSource: (packId: string, input: UploadSourceInput, options: UploadOptions = {}) => {
    const body = new FormData();
    body.append('kind', input.kind);
    body.append('file', input.file);
    if (input.title?.trim()) body.append('title', input.title.trim());
    settingsFields(body, input.settings);
    return apiUploadWithProgress<ImportProcessingStatus>(
      `/study-packs/${packId}/sources/upload`,
      body,
      options,
    );
  },

  /** Adds a YouTube source: public metadata plus the student's own transcript. */
  addYouTubeSource: (
    packId: string,
    input: { url: string; transcript?: string; title?: string; settings?: Partial<GenerationSettings> },
  ) => api.post<ImportProcessingStatus>(`/study-packs/${packId}/sources/youtube`, input),

  status: (packId: string) =>
    api.get<ImportProcessingStatus>(`/study-packs/${packId}/processing`),

  /**
   * Starts, retries or re-runs processing. `stage` retries exactly one stage
   * ("Retry extraction", "Retry generation") without uploading anything again.
   */
  process: (
    packId: string,
    options: {
      sourceId?: string | null;
      stage?: 'extract' | 'normalize' | 'analyze' | 'generate' | 'review' | 'plan' | null;
      settings?: Partial<GenerationSettings>;
    } = {},
  ) =>
    api.post<ImportProcessingStatus>(`/study-packs/${packId}/process`, {
      sourceId: options.sourceId ?? null,
      ...(options.stage ? { stage: options.stage } : {}),
      ...(options.settings ? { settings: options.settings } : {}),
    }),
};
