/**
 * PowerPoint extraction: real .pptx parts, real slide references.
 *
 * The fixtures are built as actual zips with JSZip (no external service, no
 * binary blob in the repo), so these tests exercise the same code path a real
 * deck takes: slide XML → titles, body text, speaker notes and metadata.
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { assertUploadedSource } from '../middleware/source-upload.js';
import {
  decodeXmlEntities,
  extractPresentation,
  MAX_PPTX_BYTES,
  MAX_PPTX_SLIDES,
} from './source-pptx.js';

interface SlideFixture {
  title?: string;
  body?: string;
  notes?: string;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shape(text: string, placeholder: string): string {
  return (
    '<p:sp><p:nvSpPr><p:cNvPr id="1" name="Shape"/>' +
    `<p:nvPr><p:ph type="${placeholder}"/></p:nvPr></p:nvSpPr>` +
    `<p:txBody><a:p><a:r><a:t>${escapeXml(text)}</a:t></a:r></a:p></p:txBody></p:sp>`
  );
}

function slideXml(slide: SlideFixture): string {
  const shapes = [
    slide.title ? shape(slide.title, 'title') : '',
    slide.body ? shape(slide.body, 'body') : '',
  ].join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    `<p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`
  );
}

function notesXml(text: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:spTree>' +
    shape('Slide title', 'title') +
    shape(text, 'body') +
    '</p:spTree></p:cSld></p:notes>'
  );
}

function relsXml(notesSlide?: number): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    (notesSlide
      ? '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" ' +
        `Target="../notesSlides/notesSlide${notesSlide}.xml"/>`
      : '') +
    '</Relationships>'
  );
}

/** Builds an in-memory .pptx the way PowerPoint would lay it out. */
async function buildPptx(
  slides: SlideFixture[],
  options: { core?: { title?: string; creator?: string } } = {},
): Promise<Buffer> {
  const zip = new JSZip();
  slides.forEach((slide, index) => {
    const number = index + 1;
    zip.file(`ppt/slides/slide${number}.xml`, slideXml(slide));
    zip.file(`ppt/slides/_rels/slide${number}.xml.rels`, relsXml(slide.notes ? number : undefined));
    if (slide.notes) zip.file(`ppt/notesSlides/notesSlide${number}.xml`, notesXml(slide.notes));
  });
  if (options.core) {
    zip.file(
      'docProps/core.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        (options.core.title ? `<dc:title>${escapeXml(options.core.title)}</dc:title>` : '') +
        (options.core.creator ? `<dc:creator>${escapeXml(options.core.creator)}</dc:creator>` : '') +
        '</cp:coreProperties>',
    );
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('pptx extraction: slides, notes and metadata', () => {
  it('reads slide titles, body text and speaker notes in slide order', async () => {
    const buffer = await buildPptx(
      [
        {
          title: 'Celkern',
          body: 'De celkern bevat het DNA en regelt de celdeling.',
          notes: 'Benadruk dat de celkern het DNA beschermt.',
        },
        { title: 'Mitose', body: 'Mitose is de deling van de celkern.' },
      ],
      { core: { title: 'Biologie H3', creator: 'Mevrouw Jansen' } },
    );

    const presentation = await extractPresentation(buffer);

    expect(presentation.slideCount).toBe(2);
    expect(presentation.title).toBe('Biologie H3');
    expect(presentation.author).toBe('Mevrouw Jansen');
    expect(presentation.slides).toEqual([
      {
        slideNumber: 1,
        title: 'Celkern',
        body: 'De celkern bevat het DNA en regelt de celdeling.',
        notes: 'Benadruk dat de celkern het DNA beschermt.',
      },
      {
        slideNumber: 2,
        title: 'Mitose',
        body: 'Mitose is de deling van de celkern.',
        notes: null,
      },
    ]);
  });

  it('keeps the real slide number for provenance', async () => {
    const buffer = await buildPptx([
      { body: 'Eerste slide zonder titel.' },
      { body: 'Tweede slide.' },
      { body: 'Derde slide, hier komt de theorie over osmose.' },
    ]);

    const presentation = await extractPresentation(buffer);

    // Slide numbers are the ones in the file, so "Generated from slide 3" is true.
    expect(presentation.slides.map((slide) => slide.slideNumber)).toEqual([1, 2, 3]);
  });

  it('warns when a presentation has no speaker notes at all', async () => {
    const buffer = await buildPptx([{ title: 'Warmte', body: 'Warmte gaat van warm naar koud.' }]);

    const presentation = await extractPresentation(buffer);

    expect(presentation.warnings).toContain('No speaker notes found in this presentation.');
  });

  it('does not warn about notes when at least one slide has them', async () => {
    const buffer = await buildPptx([
      { title: 'Warmte', body: 'Warmte gaat van warm naar koud.', notes: 'Extra uitleg.' },
      { title: 'Temperatuur', body: 'Temperatuur meet warmte.' },
    ]);

    expect((await extractPresentation(buffer)).warnings).not.toContain(
      'No speaker notes found in this presentation.',
    );
  });

  it('bounds a very long deck instead of failing on it', async () => {
    const longBody = `Osmose ${'water en zout '.repeat(1_600)}`;
    const buffer = await buildPptx([
      { title: 'Een', body: longBody },
      { title: 'Twee', body: longBody },
      { title: 'Drie', body: longBody },
      { title: 'Vier', body: 'Nooit gebruikt.' },
    ]);

    const presentation = await extractPresentation(buffer);

    expect(presentation.warnings).toContain('This presentation is long. Lerno uses the first part of it.');
    expect(presentation.slides.length).toBeLessThan(4);
  });

  it('decodes the XML entities Office writes', () => {
    expect(decodeXmlEntities('Mitose &amp; meiose')).toBe('Mitose & meiose');
    expect(decodeXmlEntities('&lt;p&gt; &quot;citaat&quot;')).toBe('<p> "citaat"');
    expect(decodeXmlEntities('&#233;n &#x27;apostrof&#x27;')).toBe('én \'apostrof\'');
  });
});

describe('pptx extraction: honest failures', () => {
  it('rejects a zip without any slides', async () => {
    const zip = new JSZip();
    zip.file('docProps/core.xml', '<cp:coreProperties/>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(extractPresentation(buffer)).rejects.toThrow(
      'This file does not look like a PowerPoint presentation. Save it as .pptx and try again.',
    );
  });

  it('rejects slides without any readable text', async () => {
    const buffer = await buildPptx([{ body: '' }, { title: undefined, body: '' }]);

    await expect(extractPresentation(buffer)).rejects.toThrow(
      'This presentation has no readable text on its slides. Lerno cannot study pictures-only slides.',
    );
  });

  it('rejects a damaged zip with a repairable message', async () => {
    const broken = Buffer.from('PK\u0003\u0004 dit is geen echte zip maar begint wel goed');

    await expect(extractPresentation(broken)).rejects.toThrow(
      'This PowerPoint file could not be opened. It may be damaged.',
    );
  });

  it('rejects a file that is not a pptx at all', async () => {
    await expect(extractPresentation(Buffer.from('Gewoon een tekstbestand'))).rejects.toThrow(
      'This file is not a valid PowerPoint (.pptx) file.',
    );
  });

  it('rejects an oversized presentation before parsing it', async () => {
    const buffer = Buffer.alloc(MAX_PPTX_BYTES + 1, 0x41);
    buffer.write('PK', 0, 'ascii');

    await expect(extractPresentation(buffer)).rejects.toThrow(
      'PowerPoint files must be 25 MB or smaller.',
    );
  });

  it('rejects a deck with more slides than the limit', async () => {
    const slides = Array.from({ length: MAX_PPTX_SLIDES + 1 }, () => ({ body: 'Slide met tekst.' }));
    const buffer = await buildPptx(slides);

    await expect(extractPresentation(buffer)).rejects.toThrow(
      `This presentation has ${MAX_PPTX_SLIDES + 1} slides. The limit is ${MAX_PPTX_SLIDES} slides.`,
    );
  });
});

describe('pptx upload guard', () => {
  const file = (overrides: Partial<{ mimetype: string; originalname: string }> = {}) => ({
    mimetype:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    originalname: 'Biologie H3.pptx',
    ...overrides,
  });

  it('accepts a real pptx upload', () => {
    expect(() => assertUploadedSource('powerpoint', file() as never, 'powerpoint')).not.toThrow();
  });

  it('rejects a file whose declared type is not a pptx', () => {
    expect(() =>
      assertUploadedSource('powerpoint', file({ mimetype: 'text/plain' }) as never, 'powerpoint'),
    ).toThrow('That file type is not supported for powerpoint sources.');
  });

  it('rejects a pptx with the wrong extension', () => {
    expect(() =>
      assertUploadedSource('powerpoint', file({ originalname: 'Biologie H3.pdf' }) as never, 'powerpoint'),
    ).toThrow('That file type does not match a powerpoint source.');
  });

  it('rejects a file that claims to be a different kind', () => {
    expect(() =>
      assertUploadedSource('powerpoint', file() as never, 'image'),
    ).toThrow('That file type does not match the source you are adding.');
  });
});
