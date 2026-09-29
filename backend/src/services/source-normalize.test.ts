/**
 * Normalization: PDF, PPTX, OCR, transcripts, YouTube and pasted text all become
 * the same shape (id, title, type, text, sections, references, metadata). This is
 * the contract every AI task works against, and the reason provenance like
 * "Biologie H3.pdf · page 6" or "3:42 in recording" can be trusted.
 */
import { describe, expect, it } from 'vitest';
import type { StudyPackSourceRecord } from '../lib/db/types.js';
import {
  MAX_NORMALIZED_CHARS,
  buildSourceContext,
  detectTextSections,
  normalizeChunks,
  normalizePlainText,
  provenanceForEntry,
  renderWithMarkers,
  resolveMarker,
  toNormalizedSource,
} from './source-normalize.js';

const NOTES = [
  'Celkern',
  'De celkern bevat het DNA en regelt wat de cel doet.',
  'Mitose',
  'Mitose is de deling van de celkern.',
].join('\n');

function sourceRecord(overrides: Partial<StudyPackSourceRecord> = {}): StudyPackSourceRecord {
  return {
    id: 'source-1',
    packId: 'pack-1',
    kind: 'text',
    title: 'Notities.md',
    content: NOTES,
    status: 'ready',
    characterCount: NOTES.length,
    pageCount: null,
    failureReason: null,
    legacySetId: null,
    origin: 'user',
    metadata: null,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
    ...overrides,
  } as StudyPackSourceRecord;
}

describe('normalization: one shape for every source type', () => {
  it('normalizes pasted text with detected sections', () => {
    const source = normalizePlainText({
      sourceId: 'source-1',
      title: 'Notities.md',
      kind: 'text',
      text: NOTES,
    });

    expect(source.sourceId).toBe('source-1');
    expect(source.kind).toBe('text');
    expect(source.language).toBe('nl');
    expect(source.metadata.extractedBy).toBe('user');
    expect(source.metadata.referenceKind).toBe('none');
    expect(source.sections.map((section) => section.title)).toEqual(['Celkern', 'Mitose']);
  });

  it('turns PDF pages into page references', () => {
    const { text, references, sections } = normalizeChunks(
      [
        { text: 'Hoofdstuk 3: celdeling', page: 1, section: 'Hoofdstuk 3' },
        { text: 'Mitose is de deling van de celkern.', page: 6, section: 'Mitose' },
      ],
      { kind: 'pdf', referenceKind: 'page' },
    );

    expect(text).toBe('Hoofdstuk 3: celdeling\n\nMitose is de deling van de celkern.');
    expect(references).toEqual([
      expect.objectContaining({ marker: 'p1', kind: 'page', label: 'page 1', start: 0 }),
      expect.objectContaining({ marker: 'p6', kind: 'page', label: 'page 6' }),
    ]);
    expect(sections.map((section) => section.title)).toEqual(['Hoofdstuk 3', 'Mitose']);
  });

  it('turns slides into slide references and titles into sections', () => {
    const { references, sections } = normalizeChunks(
      [
        { text: 'Celkern\nDe celkern bevat het DNA.', slide: 8, section: 'Celkern' },
        { text: 'Mitose\nMitose deelt de celkern.', slide: 9, section: 'Mitose' },
      ],
      { kind: 'powerpoint', referenceKind: 'slide' },
    );

    expect(references.map((reference) => reference.marker)).toEqual(['s8', 's9']);
    expect(references[0]?.label).toBe('slide 8');
    expect(sections[0]).toEqual(expect.objectContaining({ title: 'Celkern', marker: 's8' }));
  });

  it('keeps transcript offsets as timestamps', () => {
    const { references } = normalizeChunks(
      [
        { text: 'De celkern bevat het DNA.', startSeconds: 0, endSeconds: 4.2 },
        { text: 'Mitose deelt de celkern.', startSeconds: 222, endSeconds: 226.4 },
      ],
      { kind: 'audio', referenceKind: 'timestamp' },
    );

    expect(references.map((reference) => reference.marker)).toEqual(['t0', 't222']);
    expect(references[1]?.label).toBe('3:42 in recording');
    expect(references[1]?.startSeconds).toBe(222);
  });

  it('normalizes an OCR source and a YouTube transcript', () => {
    const ocr = normalizePlainText(
      { sourceId: 'source-2', title: 'Foto van bord', kind: 'image', text: 'Osmose: water gaat door een membraan.' },
      { referenceKind: 'section' },
    );
    expect(ocr.metadata.extractedBy).toBe('ocr');
    expect(ocr.metadata.referenceKind).toBe('section');

    const youtube = normalizeChunks([{ text: 'Uitleg over celdeling.', startSeconds: 30 }], {
      kind: 'youtube',
      referenceKind: 'video',
    });
    expect(youtube.references).toEqual([expect.objectContaining({ marker: 'x1', kind: 'video' })]);
  });

  it('deduplicates repeated markers and drops empty chunks', () => {
    const { text, references } = normalizeChunks(
      [
        { text: 'Eerste alinea.', page: 3 },
        { text: 'Tweede alinea op dezelfde pagina.', page: 3 },
        { text: '   ', page: 4 },
      ],
      { kind: 'pdf', referenceKind: 'page' },
    );

    expect(references).toHaveLength(1);
    expect(text).toBe('Eerste alinea.\n\nTweede alinea op dezelfde pagina.');
  });

  it('bounds the normalized text to the source limit', () => {
    const { text } = normalizeChunks([{ text: 'a'.repeat(MAX_NORMALIZED_CHARS + 10_000) }], {
      kind: 'text',
      referenceKind: 'none',
    });

    expect(text.length).toBe(MAX_NORMALIZED_CHARS);
  });

  it('detects headings without guessing at sentences', () => {
    const sections = detectTextSections(
      ['Celdeling', 'Dit is een gewone zin met een punt.', 'Mitose'].join('\n'),
    );

    expect(sections.map((section) => section.title)).toEqual(['Celdeling', 'Mitose']);
  });

  it('rebuilds the normalized source from a stored row', () => {
    const stored = sourceRecord({
      kind: 'pdf',
      metadata: {
        language: 'nl',
        referenceKind: 'page',
        extractedBy: 'pdf-text',
        references: [{ marker: 'p6', kind: 'page', label: 'page 6', start: 0, page: 6, slide: null, startSeconds: null, endSeconds: null }],
        sections: [{ title: 'Mitose', marker: 'p6', start: 0 }],
      },
    });

    const source = toNormalizedSource(stored as never);

    expect(source.kind).toBe('pdf');
    expect(source.references[0]?.label).toBe('page 6');
    expect(source.sections[0]?.title).toBe('Mitose');
  });

  it('falls back to detecting the language of stored content without metadata', () => {
    expect(toNormalizedSource(sourceRecord({ metadata: null }) as never).language).toBe('nl');
  });
});

describe('normalization: markers the model may copy', () => {
  const sources = [
    normalizePlainText(
      { sourceId: 'source-a', title: 'Biologie H3.pdf', kind: 'pdf', text: 'Mitose deelt de celkern.' },
      {
        referenceKind: 'page',
        references: [{ marker: 'p6', kind: 'page', label: 'page 6', start: 0, page: 6, slide: null, startSeconds: null, endSeconds: null }],
      },
    ),
    normalizePlainText(
      { sourceId: 'source-b', title: 'Lesnotities.pdf', kind: 'pdf', text: 'Celdeling splitst de cel.' },
      {
        referenceKind: 'page',
        references: [{ marker: 'p2', kind: 'page', label: 'page 2', start: 0, page: 2, slide: null, startSeconds: null, endSeconds: null }],
      },
    ),
  ];

  it('numbers the sources and writes the markers inline', () => {
    const context = buildSourceContext(sources, { maxChars: 4_000 });

    expect(context.text).toContain('[SOURCE 1] Biologie H3.pdf');
    expect(context.text).toContain('[SOURCE 2] Lesnotities.pdf');
    expect(context.text).toContain('[[1:p6]]');
    expect(context.text).toContain('[[2:p2]]');
    expect(context.usedSourceIds).toEqual(['source-a', 'source-b']);
  });

  it('resolves every marker it emitted', () => {
    const context = buildSourceContext(sources, { maxChars: 4_000 });

    const entry = resolveMarker(context, '1:p6');
    expect(entry?.sourceId).toBe('source-a');
    expect(provenanceForEntry(entry)).toBe('Biologie H3.pdf · page 6');
    expect(context.text).toContain(`[[${entry?.token}]]`);
  });

  it('never resolves a marker the model invented', () => {
    const context = buildSourceContext(sources, { maxChars: 4_000 });

    expect(resolveMarker(context, '3:p9')).toBeNull();
    expect(resolveMarker(context, '1:p99')).toBeNull();
    expect(resolveMarker(context, 'Biologie H3.pdf')).toBeNull();
    expect(resolveMarker(context, null)).toBeNull();
    expect(provenanceForEntry(resolveMarker(context, 'made-up'))).toBeNull();
  });

  it('inserts markers at the offset the reference really has', () => {
    const body = 'Eerste pagina.\n\nTweede pagina met mitose.';
    const rendered = renderWithMarkers(body, [
      { marker: 'p1', kind: 'page', label: 'page 1', start: 0, page: 1, slide: null, startSeconds: null, endSeconds: null },
      { marker: 'p2', kind: 'page', label: 'page 2', start: 16, page: 2, slide: null, startSeconds: null, endSeconds: null },
    ]);

    expect(rendered).toBe('[[p1]] Eerste pagina.\n\n[[p2]] Tweede pagina met mitose.');
  });

  it('leaves text without references untouched', () => {
    expect(renderWithMarkers('Gewone tekst.', [])).toBe('Gewone tekst.');
  });

  it('gives a source without inner structure one source-level token', () => {
    const notes = normalizePlainText({
      sourceId: 'source-c',
      title: 'Lesnotities',
      kind: 'text',
      text: 'De celkern bevat het DNA en regelt de celdeling in de cel.',
    });

    const context = buildSourceContext([sources[0]!, notes], { maxChars: 4_000 });

    // Without a token the model could never attribute an item to the notes.
    expect(context.text).toContain('[[2:x1]]');
    const entry = resolveMarker(context, '2:x1');
    expect(entry?.sourceId).toBe('source-c');
    expect(entry?.reference.kind).toBe('none');
  });

  it('stays within the character budget', () => {
    const long = normalizePlainText({
      sourceId: 'source-c',
      title: 'Lang.pdf',
      kind: 'pdf',
      text: 'Mitose. '.repeat(3_000),
    });

    const context = buildSourceContext([long], { maxChars: 2_000 });

    expect(context.characters).toBeLessThanOrEqual(2_000);
    expect(context.text.length).toBeLessThanOrEqual(2_000);
  });
});
