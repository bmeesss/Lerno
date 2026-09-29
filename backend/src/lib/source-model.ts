/**
 * The one normalized representation of study material (source model).
 *
 * Every kind of material Lerno accepts — pasted text, PDF, PowerPoint, image
 * (OCR), audio (transcription) and YouTube (captions) — is turned into the same
 * shape before any AI sees it:
 *
 *   Source → Validate → Extract → Normalize → Analyze → Generate → Review → Ready
 *
 * Pure module: no database, no AI, no I/O, so it can be unit tested and reused by
 * every layer (pipeline, generation, tutor, DTOs).
 */

/** Kinds of material a Study Pack can be built from. All of these are live. */
export type PackSourceKind = 'text' | 'pdf' | 'set' | 'powerpoint' | 'youtube' | 'image' | 'audio';

/**
 * Lifecycle of one source. `pending`/`processing` mean Lerno is still working,
 * `ready` means the normalized content is usable, `failed` is honest and keeps
 * the material so the student can retry just the failed stage.
 */
export type PackSourceStatus = 'pending' | 'uploading' | 'processing' | 'ready' | 'failed';

/** Internal stages of the source pipeline (progress reporting, not business logic). */
export type SourceProcessingStage =
  | 'upload'
  | 'extract'
  | 'normalize'
  | 'analyze'
  | 'generate'
  | 'review';

export const SOURCE_PROCESSING_STAGES: SourceProcessingStage[] = [
  'upload',
  'extract',
  'normalize',
  'analyze',
  'generate',
  'review',
];

/** Languages Lerno can generate in. `unknown` follows the material itself. */
export type SourceLanguage = 'nl' | 'en' | 'unknown';

export const SOURCE_LANGUAGES: SourceLanguage[] = ['nl', 'en', 'unknown'];

export type SourceReferenceKind =
  | 'page'
  | 'slide'
  | 'timestamp'
  | 'section'
  | 'card'
  | 'video'
  | 'none';

/**
 * One place inside a source. Stored with the source so every generated item can
 * say where it came from: "page 6", "slide 8", "03:42 in recording".
 *
 * `marker` is the short token put inside the AI context (e.g. `p6`, `s8`, `t222`)
 * so a generated item can point back at exactly one reference. A marker Lerno did
 * not emit is rejected, never rendered.
 */
export interface SourceReference {
  marker: string;
  kind: SourceReferenceKind;
  /** Human label, e.g. "page 6" / "slide 8" / "03:42" / "section \"Cell division\"". */
  label: string;
  /** Character offset of this reference inside the normalized text. */
  start: number;
  page?: number | null;
  slide?: number | null;
  startSeconds?: number | null;
  endSeconds?: number | null;
}

/** How a source was turned into text (provenance of the extraction itself). */
export type SourceExtractionMethod =
  | 'user'
  | 'pdf-text'
  | 'pptx-xml'
  | 'ocr'
  | 'transcription'
  | 'youtube-captions'
  | 'set';

export interface SourceSection {
  title: string;
  /** Marker whose reference starts this section (may be a synthetic `x1`). */
  marker: string;
  start: number;
}

export interface SourceMetadata {
  language: SourceLanguage;
  referenceKind: SourceReferenceKind;
  extractedBy: SourceExtractionMethod;
  references: SourceReference[];
  sections: SourceSection[];
  pageCount: number | null;
  slideCount: number | null;
  durationSeconds: number | null;
  channel: string | null;
  url: string | null;
  videoId: string | null;
  /** Honest, user-facing notes about what extraction could or could not do. */
  warnings: string[];
}

export const EMPTY_SOURCE_METADATA: SourceMetadata = {
  language: 'unknown',
  referenceKind: 'none',
  extractedBy: 'user',
  references: [],
  sections: [],
  pageCount: null,
  slideCount: null,
  durationSeconds: null,
  channel: null,
  url: null,
  videoId: null,
  warnings: [],
};

/** One side of a disagreement between two sources. */
export interface SourceConflictClaim {
  statement: string;
  sourceId: string;
  /** Reference marker inside that source (verified against its references). */
  marker: string;
  referenceLabel: string;
  /** Short quote from the source that supports the claim (verified). */
  quote: string;
}

/** Two sources that say different things — never merged into one "fact". */
export interface SourceConflict {
  topic: string;
  explanation: string;
  claims: SourceConflictClaim[];
}

export type MaterialDifficulty = 'easy' | 'medium' | 'hard';

/** The stored, source-grounded analysis every generation reuses. */
export interface PackAnalysis {
  summary: string;
  keyFacts: string[];
  relationships: string[];
  examTopics: string[];
  difficulty: MaterialDifficulty;
  sections: { title: string; marker: string }[];
  conflicts: SourceConflict[];
  /** Sources that actually contributed to this analysis. */
  sourceIds: string[];
  createdAt: string;
}

export type GenerationLanguage = 'nl' | 'en';

export const GENERATION_LANGUAGES: GenerationLanguage[] = ['nl', 'en'];

export const LANGUAGE_LABELS: Record<GenerationLanguage, string> = {
  nl: 'Nederlands',
  en: 'English',
};

/** Simple, deterministic two-language detection (Dutch vs. English). */
export function detectSourceLanguage(text: string): SourceLanguage {
  const words = text.toLowerCase().match(/[a-zà-ÿ]+/gi) ?? [];
  if (words.length < 8) return 'unknown';
  const sample = words.slice(0, 400);
  const dutch = new Set([
    'de',
    'het',
    'een',
    'en',
    'van',
    'is',
    'wordt',
    'die',
    'dat',
    'niet',
    'met',
    'voor',
    'zijn',
    'als',
    'op',
    'aan',
    'ook',
    'maar',
    'door',
    'tussen',
    'welke',
    'omdat',
  ]);
  const english = new Set([
    'the',
    'a',
    'an',
    'and',
    'of',
    'is',
    'are',
    'to',
    'in',
    'that',
    'which',
    'with',
    'for',
    'as',
    'on',
    'by',
    'not',
    'but',
    'from',
    'this',
    'these',
    'because',
    'between',
  ]);
  let nl = 0;
  let en = 0;
  for (const word of sample) {
    if (dutch.has(word)) nl += 1;
    if (english.has(word)) en += 1;
  }
  if (nl === 0 && en === 0) return 'unknown';
  if (nl >= en * 1.2) return 'nl';
  if (en >= nl * 1.2) return 'en';
  return 'unknown';
}

/** Resolves the language AI output must use: the student's choice wins. */
export function resolveGenerationLanguage(
  chosen: GenerationLanguage | null | undefined,
  materialLanguages: SourceLanguage[],
): GenerationLanguage {
  if (chosen) return chosen;
  const counts = { nl: 0, en: 0 };
  for (const language of materialLanguages) {
    if (language === 'nl' || language === 'en') counts[language] += 1;
  }
  if (counts.nl === 0 && counts.en === 0) return 'nl';
  return counts.nl >= counts.en ? 'nl' : 'en';
}

/** "03:42" / "1:02:07" — used for audio and video provenance. */
export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/** Human label for one reference kind (kept in one place for the whole app). */
export function referenceLabel(
  kind: SourceReferenceKind,
  value: { page?: number | null; slide?: number | null; label?: string | null; startSeconds?: number | null },
): string {
  switch (kind) {
    case 'page':
      return `page ${value.page ?? '?'}`;
    case 'slide':
      return `slide ${value.slide ?? '?'}`;
    case 'timestamp':
      return value.startSeconds === null || value.startSeconds === undefined
        ? 'recording'
        : `${formatTimestamp(value.startSeconds)} in recording`;
    case 'section':
      return value.label ? `section "${value.label}"` : 'section';
    case 'card':
      return `card ${value.page ?? '?'}`;
    case 'video':
      return 'video';
    default:
      return 'source';
  }
}

/** "Source: Biology Chapter 3.pdf · page 6" — used by concepts, cards, questions. */
export function provenanceLabel(sourceTitle: string, referenceLabelText: string | null): string {
  const clean = sourceTitle.trim() || 'source';
  return referenceLabelText ? `${clean} · ${referenceLabelText}` : clean;
}
