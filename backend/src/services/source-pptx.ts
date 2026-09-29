/**
 * PowerPoint (.pptx) extraction.
 *
 * A .pptx file is a zip of XML parts. Lerno reads the real parts instead of
 * guessing from the file name:
 *
 *   ppt/slides/slideN.xml            → slide text, in slide order
 *   ppt/slides/_rels/slideN.xml.rels → which notes slide belongs to slide N
 *   ppt/notesSlides/notesSlideN.xml  → speaker notes (when present)
 *   docProps/core.xml                → presentation title/author (metadata only)
 *
 * Slide titles come from the title placeholder, so provenance can say
 * "Generated from slide 8" and point at the actual slide. Files are handled
 * entirely in memory; nothing is written to disk. Decks without any readable
 * slide text fail honestly instead of producing an empty source.
 */
import JSZip from 'jszip';
import { errors } from '../lib/errors.js';
import { sanitizeMaterialText } from './material-analysis.js';

/** Hard limits for one presentation (bytes, slides, characters). */
export const MAX_PPTX_BYTES = 25 * 1024 * 1024;
export const MAX_PPTX_SLIDES = 150;
export const MAX_PPTX_CHARS = 50_000;
const MAX_NOTES_CHARS = 4_000;

export interface ExtractedSlide {
  slideNumber: number;
  title: string | null;
  body: string;
  notes: string | null;
}

export interface ExtractedPresentation {
  slides: ExtractedSlide[];
  slideCount: number;
  title: string | null;
  author: string | null;
  warnings: string[];
}

/** Placeholders that only carry page furniture, never study content. */
const NOISE_PLACEHOLDERS = new Set(['sldNum', 'ftr', 'dt', 'hdr']);
const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle']);

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Minimal XML entity decoding — enough for Office text runs. */
export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => XML_ENTITIES[name.toLowerCase()] ?? match);
}

/** All `<a:t>` runs of one shape/tables block, in document order. */
function runText(xml: string): string {
  const parts: string[] = [];
  const pattern = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let match = pattern.exec(xml);
  while (match) {
    parts.push(decodeXmlEntities(match[1] ?? ''));
    match = pattern.exec(xml);
  }
  return sanitizeMaterialText(parts.join(' '));
}

function placeholderType(block: string): string | null {
  const match = /<p:ph\b[^>]*>/i.exec(block);
  if (!match) return null;
  const type = /type="([^"]+)"/i.exec(match[0]);
  return type?.[1]?.toLowerCase() ?? 'body';
}

/** Text blocks of one slide: shapes plus tables/graphic frames, in order. */
function slideTextBlocks(xml: string): { placeholder: string | null; text: string }[] {
  const blocks: { placeholder: string | null; text: string }[] = [];
  const pattern = /<p:(sp|graphicFrame)\b[\s\S]*?<\/p:\1>/g;
  let match = pattern.exec(xml);
  while (match) {
    const block = match[0];
    const text = runText(block);
    if (text) blocks.push({ placeholder: placeholderType(block), text });
    match = pattern.exec(xml);
  }
  return blocks;
}

function tagValue(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  if (!match) return null;
  const value = sanitizeMaterialText(decodeXmlEntities(match[1] ?? ''));
  return value || null;
}

/** Extracts slides, notes and metadata from one in-memory .pptx file. */
export async function extractPresentation(buffer: Buffer): Promise<ExtractedPresentation> {
  if (buffer.length === 0 || buffer.length > MAX_PPTX_BYTES) {
    throw errors.validation('PowerPoint files must be 25 MB or smaller.');
  }
  if (buffer.subarray(0, 2).toString('ascii') !== 'PK') {
    throw errors.validation('This file is not a valid PowerPoint (.pptx) file.');
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { createFolders: false });
  } catch {
    throw errors.validation('This PowerPoint file could not be opened. It may be damaged.');
  }

  const slidePaths = Object.keys(zip.files)
    .map((path) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(path))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ path: match[0], index: Number.parseInt(match[1]!, 10) }))
    .sort((a, b) => a.index - b.index);

  if (slidePaths.length === 0) {
    throw errors.validation(
      'This file does not look like a PowerPoint presentation. Save it as .pptx and try again.',
    );
  }
  if (slidePaths.length > MAX_PPTX_SLIDES) {
    throw errors.validation(
      `This presentation has ${slidePaths.length} slides. The limit is ${MAX_PPTX_SLIDES} slides.`,
    );
  }

  const warnings: string[] = [];
  const slides: ExtractedSlide[] = [];
  let totalChars = 0;

  for (const slide of slidePaths) {
    const xml = await zip.file(slide.path)?.async('string');
    if (!xml) continue;
    const blocks = slideTextBlocks(xml).filter(
      (block) => !(block.placeholder && NOISE_PLACEHOLDERS.has(block.placeholder)),
    );
    const titleBlock = blocks.find(
      (block) => block.placeholder && TITLE_PLACEHOLDERS.has(block.placeholder),
    );
    const title = titleBlock?.text.slice(0, 160) ?? null;
    const body = sanitizeMaterialText(
      blocks
        .filter((block) => block !== titleBlock)
        .map((block) => block.text)
        .join('\n'),
    );
    const notes = sanitizeMaterialText(
      (await readNotes(zip, slide.index))?.slice(0, MAX_NOTES_CHARS) ?? '',
    );
    totalChars += (title?.length ?? 0) + body.length + notes.length;
    if (totalChars > MAX_PPTX_CHARS) {
      warnings.push('This presentation is long. Lerno uses the first part of it.');
      break;
    }
    if (title || body || notes) {
      slides.push({
        slideNumber: slide.index,
        title,
        body,
        notes: notes || null,
      });
    }
  }

  if (slides.length === 0) {
    throw errors.validation(
      'This presentation has no readable text on its slides. Lerno cannot study pictures-only slides.',
    );
  }

  const core = await zip.file('docProps/core.xml')?.async('string');
  if (!slides.some((slide) => slide.notes)) {
    warnings.push('No speaker notes found in this presentation.');
  }

  return {
    slides,
    slideCount: slidePaths.length,
    title: core ? tagValue(core, 'dc:title') : null,
    author: core ? tagValue(core, 'dc:creator') : null,
    warnings,
  };
}

/** Speaker notes for one slide, resolved through its relationships file. */
async function readNotes(zip: JSZip, slideIndex: number): Promise<string | null> {
  const relsPath = `ppt/slides/_rels/slide${slideIndex}.xml.rels`;
  const rels = await zip.file(relsPath)?.async('string');
  let notesPath: string | null = null;
  if (rels) {
    const pattern = /<Relationship\b[^>]*>/g;
    let match = pattern.exec(rels);
    while (match) {
      if (/notesSlide/i.test(match[0])) {
        const target = /Target="([^"]+)"/i.exec(match[0])?.[1];
        if (target) {
          // Relationships are relative to ppt/slides/, e.g. "../notesSlides/notesSlide1.xml".
          notesPath = target
            .replace(/^\.\.\//, 'ppt/')
            .replace(/^\.\//, 'ppt/slides/')
            .replace(/^\//, '');
          break;
        }
      }
      match = pattern.exec(rels);
    }
  }
  if (!notesPath) return null;
  const xml = await zip.file(notesPath)?.async('string');
  if (!xml) return null;
  // Notes slides repeat the slide title in a placeholder; only the body matters.
  const blocks = slideTextBlocks(xml).filter(
    (block) => !(block.placeholder && TITLE_PLACEHOLDERS.has(block.placeholder)),
  );
  const text = blocks.map((block) => block.text).join('\n');
  return text ? sanitizeMaterialText(text) : null;
}
