/**
 * Extraction dispatch — raw material in, normalized chunks out.
 *
 * One entry point for every source kind, so the pipeline itself has no per-kind
 * branches. Each extractor validates the *real* file (signature, size, limits),
 * never just the extension, and returns chunk boundaries that become provenance:
 *
 *   PDF              → one chunk per page                ("page 6")
 *   PowerPoint       → one chunk per slide + notes       ("slide 8")
 *   image (OCR)      → one chunk per recognized block    (source level)
 *   audio            → one chunk per transcript segment  ("03:42 in recording")
 *   YouTube          → transcript supplied by the student
 *   pasted text/set  → the text itself
 */
import type { PackSourceKind, SourceExtractionMethod, SourceReferenceKind, SourceSection } from '../lib/source-model.js';
import { errors } from '../lib/errors.js';
import type { ExtractedChunk } from './source-normalize.js';
import { extractPdfPages, MAX_STUDIO_PDF_BYTES } from './ai-studio-pdf.js';
import { extractPresentation } from './source-pptx.js';
import { ocrImage, IMAGE_MIME_TYPES } from './source-ocr.js';
import { transcribeAudio, AUDIO_MIME_TYPES } from './source-transcribe.js';
import { resolveYouTubeSource } from './source-youtube.js';

/** Extensions accepted per kind (checked next to the MIME type and signature). */
export const SOURCE_EXTENSIONS: Record<'pdf' | 'powerpoint' | 'image' | 'audio', string[]> = {
  pdf: ['.pdf'],
  powerpoint: ['.pptx'],
  image: ['.png', '.jpg', '.jpeg', '.webp'],
  audio: ['.mp3', '.wav', '.m4a', '.webm', '.ogg'],
};

/** Binary upload kinds (one discriminated member per kind for clean narrowing). */
export type FileSourceKind = Extract<PackSourceKind, 'pdf' | 'powerpoint' | 'image' | 'audio'>;

export type FileExtractionInput = {
  [Kind in FileSourceKind]: {
    kind: Kind;
    buffer: Buffer;
    filename: string;
    mimeType: string;
  };
}[FileSourceKind];

export type TextExtractionInput =
  | { kind: 'text'; text: string }
  | { kind: 'set'; text: string };

export interface YouTubeExtractionInput {
  kind: 'youtube';
  url: string;
  transcript: string | null;
}

export type ExtractionInput = FileExtractionInput | TextExtractionInput | YouTubeExtractionInput;

export interface ExtractionOutcome {
  chunks: ExtractedChunk[];
  referenceKind: SourceReferenceKind;
  extractedBy: SourceExtractionMethod;
  pageCount: number | null;
  slideCount: number | null;
  durationSeconds: number | null;
  channel: string | null;
  url: string | null;
  videoId: string | null;
  warnings: string[];
  /** Section titles the extractor really found (slide titles, PDF pages). */
  sections: SourceSection[];
}

/** Extension check: the filename must match the kind we are about to parse. */
export function assertSourceExtension(kind: keyof typeof SOURCE_EXTENSIONS, filename: string): void {
  const lower = filename.toLowerCase();
  const allowed = SOURCE_EXTENSIONS[kind];
  if (!allowed.some((extension) => lower.endsWith(extension))) {
    const article = kind === 'image' || kind === 'audio' ? 'an' : 'a';
    throw errors.validation(`That file type does not match ${article} ${kind} source.`);
  }
}

/** MIME allow-list per kind, shared by the upload middleware and the pipeline. */
export function allowedMimeTypes(kind: 'pdf' | 'powerpoint' | 'image' | 'audio'): string[] {
  switch (kind) {
    case 'pdf':
      return ['application/pdf', 'application/x-pdf', 'application/octet-stream'];
    case 'powerpoint':
      return [
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-powerpoint',
        'application/zip',
        'application/octet-stream',
      ];
    case 'image':
      return [...IMAGE_MIME_TYPES];
    case 'audio':
      return [...AUDIO_MIME_TYPES];
  }
}

/** Real signature check for the containers Lerno accepts. */
export function assertFileSignature(kind: 'powerpoint' | 'image' | 'audio' | 'pdf', buffer: Buffer): void {
  if (buffer.length === 0) throw errors.validation('That file is empty.');
  switch (kind) {
    case 'powerpoint':
      if (buffer.subarray(0, 2).toString('ascii') !== 'PK') {
        throw errors.validation('This file is not a valid PowerPoint (.pptx) file.');
      }
      return;
    case 'pdf':
      if (buffer.subarray(0, 1024).indexOf(Buffer.from('%PDF-', 'ascii')) === -1) {
        throw errors.validation('This file is not a valid PDF.');
      }
      return;
    case 'image': {
      const signatures: number[][] = [
        [0x89, 0x50, 0x4e, 0x47], // PNG
        [0xff, 0xd8, 0xff], // JPEG
        [0x52, 0x49, 0x46, 0x46], // RIFF (WEBP)
      ];
      const matches = signatures.some((signature) =>
        signature.every((byte, index) => buffer[index] === byte),
      );
      if (!matches) throw errors.validation('This file is not a PNG, JPG or WEBP image.');
      return;
    }
    case 'audio': {
      const head = buffer.subarray(0, 4).toString('ascii');
      const isRiff = head === 'RIFF';
      const isOgg = head === 'OggS';
      const isWebm = buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      const isMp3 =
        head.startsWith('ID3') ||
        (buffer[0] === 0xff && buffer[1] !== undefined && (buffer[1] & 0xe0) === 0xe0);
      const isMp4 = buffer.subarray(4, 8).toString('ascii') === 'ftyp';
      if (!isRiff && !isOgg && !isWebm && !isMp3 && !isMp4) {
        throw errors.validation('This file is not a supported recording (mp3, wav, m4a or webm).');
      }
      return;
    }
  }
}

/** Runs the extractor that belongs to the source kind. */
export async function extractSource(input: ExtractionInput): Promise<ExtractionOutcome> {
  if (input.kind === 'text' || input.kind === 'set') {
    return {
      chunks: [{ text: input.text, page: input.kind === 'set' ? 1 : null }],
      referenceKind: input.kind === 'set' ? 'card' : 'none',
      extractedBy: input.kind === 'set' ? 'set' : 'user',
      pageCount: null,
      slideCount: null,
      durationSeconds: null,
      channel: null,
      url: null,
      videoId: null,
      warnings: [],
      sections: [],
    };
  }

  if (input.kind === 'youtube') {
    const resolved = await resolveYouTubeSource({
      url: input.url,
      transcript: input.transcript,
    });
    return {
      chunks: [{ text: resolved.transcript, startSeconds: 0 }],
      referenceKind: 'video',
      extractedBy: 'youtube-captions',
      pageCount: null,
      slideCount: null,
      durationSeconds: resolved.metadata.durationSeconds,
      channel: resolved.metadata.channel,
      url: resolved.metadata.url,
      videoId: resolved.metadata.videoId,
      warnings: [],
      sections: [],
    };
  }

  assertSourceExtension(input.kind, input.filename);
  assertFileSignature(input.kind, input.buffer);

  if (input.kind === 'pdf') {
    if (input.buffer.length > MAX_STUDIO_PDF_BYTES) {
      throw errors.validation('PDFs must be 15 MB or smaller.');
    }
    const extracted = await extractPdfPages(input.buffer);
    return {
      chunks: extracted.pages.map((page) => ({ text: page.text, page: page.pageNumber })),
      referenceKind: 'page',
      extractedBy: 'pdf-text',
      pageCount: extracted.pageCount,
      slideCount: null,
      durationSeconds: null,
      channel: null,
      url: null,
      videoId: null,
      warnings: extracted.truncated
        ? ['This PDF is long. Lerno uses the first part of it.']
        : [],
      sections: extracted.pages.map((page) => ({
        title: `Page ${page.pageNumber}`,
        marker: `p${page.pageNumber}`,
        start: 0,
      })),
    };
  }

  if (input.kind === 'powerpoint') {
    const presentation = await extractPresentation(input.buffer);
    return {
      chunks: presentation.slides.flatMap((slide) => {
        const text = [slide.title, slide.body, slide.notes].filter(Boolean).join('\n');
        return text ? [{ text, slide: slide.slideNumber, section: slide.title ?? null }] : [];
      }),
      referenceKind: 'slide',
      extractedBy: 'pptx-xml',
      pageCount: null,
      slideCount: presentation.slideCount,
      durationSeconds: null,
      channel: null,
      url: null,
      videoId: null,
      warnings: presentation.warnings,
      sections: presentation.slides
        .filter((slide) => slide.title)
        .map((slide) => ({ title: slide.title!, marker: `s${slide.slideNumber}`, start: 0 })),
    };
  }

  if (input.kind === 'image') {
    const ocr = await ocrImage({ buffer: input.buffer, mimeType: input.mimeType });
    return {
      chunks: [{ text: ocr.text, page: 1 }],
      referenceKind: 'section',
      extractedBy: 'ocr',
      pageCount: null,
      slideCount: null,
      durationSeconds: null,
      channel: null,
      url: null,
      videoId: null,
      warnings: [],
      sections: [],
    };
  }

  const transcription = await transcribeAudio({
    buffer: input.buffer,
    filename: input.filename,
    mimeType: input.mimeType,
  });
  return {
    chunks: transcription.segments.map((segment) => ({
      text: segment.text,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
    })),
    referenceKind: 'timestamp',
    extractedBy: 'transcription',
    pageCount: null,
    slideCount: null,
    durationSeconds: transcription.durationSeconds,
    channel: null,
    url: null,
    videoId: null,
    warnings: [],
    sections: [],
  };
}
