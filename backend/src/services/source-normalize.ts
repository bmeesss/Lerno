/**
 * Source normalization — the single internal shape every AI feature works on.
 *
 *   PDF · PPTX · Text · OCR · Audio · YouTube  →  NormalizedSource
 *
 * A `NormalizedSource` is: source id, title, type, text, sections, references and
 * metadata. The text is the cleaned material; references are the real places it
 * came from (page, slide, timestamp, section) and are what makes provenance like
 * "Source: Biology Chapter 3.pdf · page 6" or "Generated from slide 8" possible.
 *
 * Pure module: no AI, no database, no I/O. Everything here is deterministic and
 * testable, and the extractors feed straight into it.
 */
import type { StudyPackSourceRecord } from '../lib/db/types.js';
import {
  detectSourceLanguage,
  EMPTY_SOURCE_METADATA,
  formatTimestamp,
  referenceLabel,
  type PackSourceKind,
  type SourceLanguage,
  type SourceMetadata,
  type SourceReference,
  type SourceReferenceKind,
  type SourceSection,
} from '../lib/source-model.js';
import { sanitizeMaterialText, hasUsableMaterial } from './material-analysis.js';

/** One extracted chunk with the place it came from. */
export interface ExtractedChunk {
  text: string;
  /** 1-based page or slide number. */
  page?: number | null;
  slide?: number | null;
  /** Section title discovered by the extractor (slide title, PDF heading). */
  section?: string | null;
  /** Audio/video offsets in seconds. */
  startSeconds?: number | null;
  endSeconds?: number | null;
}

export interface NormalizedSource {
  sourceId: string;
  title: string;
  kind: PackSourceKind;
  language: SourceLanguage;
  text: string;
  sections: SourceSection[];
  references: SourceReference[];
  metadata: SourceMetadata;
}

/** Character budget for one normalized source (same bound as the source validators). */
export const MAX_NORMALIZED_CHARS = 50_000;

/* ------------------------------- extraction ------------------------------- */

function markerFor(kind: SourceReferenceKind, chunk: ExtractedChunk): string {
  switch (kind) {
    case 'page':
      return `p${chunk.page ?? 0}`;
    case 'slide':
      return `s${chunk.slide ?? 0}`;
    case 'timestamp':
      return `t${Math.max(0, Math.floor(chunk.startSeconds ?? 0))}`;
    case 'card':
      return `c${chunk.page ?? 0}`;
    default:
      return 'x1';
  }
}

/**
 * Turns extracted chunks into normalized text plus the reference for every
 * chunk. Chunk boundaries become references, so every paragraph can still be
 * traced back to its page/slide/timestamp.
 */
export function normalizeChunks(
  chunks: ExtractedChunk[],
  options: { kind: PackSourceKind; referenceKind: SourceReferenceKind },
): { text: string; references: SourceReference[]; sections: SourceSection[] } {
  const references: SourceReference[] = [];
  const sections: SourceSection[] = [];
  const blocks: string[] = [];
  let offset = 0;

  const trackReferences = options.referenceKind !== 'none';

  for (const chunk of chunks) {
    const cleaned = sanitizeMaterialText(chunk.text);
    if (!cleaned) continue;
    if (blocks.length > 0) offset += 2; // the "\n\n" separator below
    const marker = markerFor(options.referenceKind, chunk);
    const reference: SourceReference = {
      marker,
      kind: options.referenceKind,
      label: referenceLabel(options.referenceKind, {
        page: chunk.page,
        slide: chunk.slide,
        startSeconds: chunk.startSeconds,
        label: chunk.section,
      }),
      start: offset,
      page: chunk.page ?? null,
      slide: chunk.slide ?? null,
      startSeconds: chunk.startSeconds ?? null,
      endSeconds: chunk.endSeconds ?? null,
    };
    // A repeated marker (two chunks with the same page) keeps the first one, and
    // text without inner structure simply has no references (the source itself
    // is the provenance).
    if (trackReferences && !references.some((existing) => existing.marker === marker)) {
      references.push(reference);
    }
    if (chunk.section && !sections.some((section) => section.title === chunk.section)) {
      sections.push({ title: chunk.section.trim().slice(0, 120), marker, start: offset });
    }
    blocks.push(cleaned);
    offset += cleaned.length;
  }

  return { text: blocks.join('\n\n').slice(0, MAX_NORMALIZED_CHARS), references, sections };
}

/** Headings in plain text: short lines without a sentence ending. */
export function detectTextSections(text: string): SourceSection[] {
  const sections: SourceSection[] = [];
  let offset = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const isHeading =
      line.length >= 3 &&
      line.length <= 70 &&
      !/[.!?;:]$/.test(line) &&
      /[\p{L}]/u.test(line) &&
      (line.split(/\s+/).length <= 8 || /^\d+(\.\d+)?\s/.test(line));
    if (isHeading && !sections.some((section) => section.title === line)) {
      sections.push({ title: line.slice(0, 120), marker: `h${sections.length + 1}`, start: offset });
    }
    offset += rawLine.length + 1;
  }
  return sections.slice(0, 40);
}

/* ------------------------------ normalized source -------------------------- */

/** Builds the normalized representation of material that is already text. */
export function normalizePlainText(
  input: { sourceId: string; title: string; kind: PackSourceKind; text: string },
  options: {
    referenceKind?: SourceReferenceKind;
    references?: SourceReference[];
    sections?: SourceSection[];
    metadata?: Partial<SourceMetadata>;
  } = {},
): NormalizedSource {
  const text = sanitizeMaterialText(input.text);
  const references = options.references ?? [];
  const sections =
    options.sections ?? (references.length > 0 ? [] : detectTextSections(text).slice(0, 40));
  const metadata: SourceMetadata = {
    ...EMPTY_SOURCE_METADATA,
    language: detectSourceLanguage(text),
    referenceKind: options.referenceKind ?? 'none',
    extractedBy: metadataMethod(input.kind),
    references,
    sections,
    ...options.metadata,
  };
  return {
    sourceId: input.sourceId,
    title: input.title,
    kind: input.kind,
    language: metadata.language,
    text,
    sections,
    references,
    metadata,
  };
}

function metadataMethod(kind: PackSourceKind): SourceMetadata['extractedBy'] {
  switch (kind) {
    case 'pdf':
      return 'pdf-text';
    case 'powerpoint':
      return 'pptx-xml';
    case 'image':
      return 'ocr';
    case 'audio':
      return 'transcription';
    case 'youtube':
      return 'youtube-captions';
    case 'set':
      return 'set';
    default:
      return 'user';
  }
}

/** Rebuilds the normalized representation from a stored source row. */
export function toNormalizedSource(record: StudyPackSourceRecord): NormalizedSource {
  const metadata: SourceMetadata = { ...EMPTY_SOURCE_METADATA, ...record.metadata };
  // Stored language wins; rows from before metadata existed are detected again.
  const language =
    metadata.language && metadata.language !== 'unknown'
      ? metadata.language
      : detectSourceLanguage(record.content ?? '');
  return {
    sourceId: record.id,
    title: record.title,
    kind: record.kind,
    language,
    text: record.content ?? '',
    sections: metadata.sections ?? [],
    references: metadata.references ?? [],
    metadata,
  };
}

/** True when a stored source has readable normalized content. */
export function hasReadableContent(source: { content: string | null }): boolean {
  return hasUsableMaterial(source.content ?? '');
}

/* --------------------------------- context -------------------------------- */

export interface SourceContextEntry {
  sourceId: string;
  sourceTitle: string;
  /** Token the model can copy into `ref`: "<sourceNumber>:<marker>". */
  token: string;
  reference: SourceReference;
}

export interface SourceContext {
  /** Numbered, bounded source block sent to the model (with [[token]] markers). */
  text: string;
  entries: Map<string, SourceContextEntry>;
  sourceNumbers: Map<string, number>;
  usedSourceIds: string[];
  characters: number;
}

/**
 * Renders the normalized sources for the model with inline provenance markers:
 *
 *   [SOURCE 1] Biologie H3.pdf (PDF document)
 *   [[1:p1]] Chapter 3 — Cell division …
 *   [[1:p6]] Mitose is de deling van de celkern …
 *
 * Markers are the only way generated items may point at a source, so a made-up
 * reference is rejected instead of shown to the student.
 */
export function renderWithMarkers(
  text: string,
  references: SourceReference[],
  sourceNumber?: number,
): string {
  if (references.length === 0) return text;
  const ordered = [...references].sort((a, b) => a.start - b.start);
  let cursor = 0;
  const parts: string[] = [];
  for (const reference of ordered) {
    const start = Math.min(Math.max(reference.start, cursor), text.length);
    if (start > cursor) parts.push(text.slice(cursor, start));
    // The token the model copies is exactly the token Lerno can resolve again: the
    // source number is part of it, so two sources with a "page 6" never collide.
    parts.push(sourceNumber ? `[[${sourceNumber}:${reference.marker}]] ` : `[[${reference.marker}]] `);
    cursor = start;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.join('');
}

function sourceKindLabel(source: NormalizedSource): string {
  switch (source.kind) {
    case 'pdf':
      return 'PDF document';
    case 'powerpoint':
      return 'PowerPoint slides';
    case 'image':
      return 'photo (OCR)';
    case 'audio':
      return 'audio recording (transcript)';
    case 'youtube':
      return 'YouTube lesson (captions)';
    case 'set':
      return 'existing Lerno study set';
    default:
      return 'pasted text';
  }
}

/** One line of source metadata that helps the model without adding facts. */
function sourceFacts(source: NormalizedSource): string {
  const facts: string[] = [];
  if (source.metadata.pageCount) facts.push(`${source.metadata.pageCount} pages`);
  if (source.metadata.slideCount) facts.push(`${source.metadata.slideCount} slides`);
  if (source.metadata.durationSeconds) {
    facts.push(`recording ${formatTimestamp(source.metadata.durationSeconds)}`);
  }
  if (source.metadata.channel) facts.push(`channel: ${source.metadata.channel}`);
  return facts.length > 0 ? ` — ${facts.join(', ')}` : '';
}

export interface SourceContextOptions {
  maxChars: number;
  /** Per-source character budget (keeps the prompt fair across sources). */
  perSourceChars?: number;
}

/** Builds the bounded, marker-annotated source block used by every AI task. */
export function buildSourceContext(
  sources: NormalizedSource[],
  options: SourceContextOptions,
): SourceContext {
  const usable = sources.filter((source) => hasUsableMaterial(source.text));
  const entries = new Map<string, SourceContextEntry>();
  const sourceNumbers = new Map<string, number>();

  const header = 'SOURCES (copy the [[n:marker]] token into "ref" for every item):';
  const perSource = Math.max(
    600,
    options.perSourceChars ??
      Math.floor((Math.max(1_500, options.maxChars) - header.length) / Math.max(1, usable.length)),
  );

  const blocks = usable.map((source, index) => {
    const number = index + 1;
    sourceNumbers.set(source.sourceId, number);
    /**
     * Material without inner structure (pasted notes, an OCR block) still needs
     * one token: without it the model could never say which source an item came
     * from, and items from those sources would be dropped as unverifiable.
     */
    const references =
      source.references.length > 0
        ? source.references
        : [{ marker: 'x1', kind: 'none' as const, label: 'source', start: 0, page: null, slide: null, startSeconds: null, endSeconds: null }];
    const body = renderWithMarkers(
      source.text.slice(0, Math.min(perSource, MAX_NORMALIZED_CHARS)),
      references,
      number,
    );
    for (const reference of references) {
      if (reference.start > perSource) continue;
      const token = `${number}:${reference.marker}`;
      if (!entries.has(token)) {
        entries.set(token, {
          sourceId: source.sourceId,
          sourceTitle: source.title,
          token,
          reference,
        });
      }
    }
    return `[SOURCE ${number}] ${source.title} (${sourceKindLabel(source)})${sourceFacts(source)}\n${body}`;
  });

  const text = [header, '', ...blocks].join('\n').slice(0, options.maxChars);

  return {
    text,
    entries,
    sourceNumbers,
    usedSourceIds: usable.map((source) => source.sourceId),
    characters: text.length,
  };
}

/**
 * Resolves a marker returned by the model to a real, verified reference. A token
 * Lerno never emitted resolves to null — invented provenance is dropped instead
 * of displayed.
 */
export function resolveMarker(
  context: SourceContext,
  marker: string | null | undefined,
): SourceContextEntry | null {
  if (!marker) return null;
  return context.entries.get(marker.trim()) ?? null;
}

/** Human provenance line, e.g. "Biologie H3.pdf · page 6". */
export function provenanceForEntry(entry: SourceContextEntry | null): string | null {
  if (!entry) return null;
  return `${entry.sourceTitle} · ${entry.reference.label}`;
}
