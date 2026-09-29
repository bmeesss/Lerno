/**
 * The unified upload endpoint: PowerPoint, images, audio and PDF all enter the
 * same pipeline through the same route, with the same validation. The declaration
 * (`kind`) decides which rules apply — a file can never slip in under another
 * kind, and the real byte limit of that kind is enforced.
 */
import JSZip from 'jszip';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';
import { importJobs } from './lib/import-job-store.js';
import { OCR_MESSAGE_NO_TEXT } from './services/source-ocr.js';

const { createCompletion } = vi.hoisted(() => ({ createCompletion: vi.fn() }));

vi.mock('groq-sdk', () => {
  class Groq {
    chat = { completions: { create: createCompletion } };
    constructor(_options: unknown) {}
  }
  return { default: Groq };
});

const mutableConfig = config as unknown as { groqApiKey: string };
const app = createApp();

let counter = 0;

async function signup(): Promise<string> {
  counter += 1;
  const email = `upload${counter}-${Math.floor(Math.random() * 1e7)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: 'Upload Student' });
  return res.body.data.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const OCR_TEXT =
  'Celkern: de celkern bevat het DNA en regelt wat de cel doet. Mitose: de deling van de celkern. ' +
  'Osmose: het verplaatsen van water door een halfdoorlatende membraan.';

const ANSWERS: Record<string, unknown> = {
  analysis: {
    summary: 'Celdeling en transport in de cel, met de celkern als regelcentrum van alles.',
    keyFacts: ['De celkern bevat het DNA.', 'Mitose deelt de celkern in twee kernen.'],
    relationships: ['De celkern regelt de celdeling.'],
    examTopics: ['Mitose'],
    difficulty: 'medium',
    sections: [],
    conflicts: [],
  },
  concepts: {
    concepts: [
      { name: 'Celkern', explanation: 'De celkern bevat het DNA en regelt de cel.', ref: '1:p1' },
      { name: 'Mitose', explanation: 'Mitose is de deling van de celkern.', ref: '1:p1' },
      { name: 'Osmose', explanation: 'Osmose verplaatst water door een membraan.', ref: '1:p1' },
    ],
  },
  summary: {
    title: 'Celbiologie',
    summary: 'De celkern bevat het DNA; mitose deelt de celkern.',
    keyPoints: ['Celkern', 'Mitose', 'Osmose'],
  },
  flashcards: {
    title: 'Celbiologie',
    description: 'Kaarten over de cel.',
    cards: [{ front: 'Wat doet de celkern?', back: 'Die bevat het DNA.', ref: '1:p1', conceptRef: 1 }],
  },
  practice: {
    questions: [
      {
        type: 'open',
        question: 'Wat is mitose?',
        answer: 'De deling van de celkern.',
        explanation: 'Mitose deelt de celkern.',
        ref: '1:p1',
        conceptRef: 2,
      },
    ],
  },
};

function completion(content: string): unknown {
  return {
    choices: [{ index: 0, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
  };
}

/** Answers the OCR call with the given text and every generation task with JSON. */
function respondWithAi(ocrText: string | null): void {
  createCompletion.mockImplementation((params: { messages: { content: unknown }[] }) => {
    const payload = params.messages
      .map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
      .join('\n');
    if (payload.includes('Transcribe every readable word')) {
      return Promise.resolve(completion(ocrText === null ? 'NO_TEXT' : ocrText));
    }
    const task = Object.keys(ANSWERS).find((key) => payload.includes(`"task":"${key}"`));
    return Promise.resolve(completion(JSON.stringify(task ? ANSWERS[task] : {})));
  });
}

/** A real single-page PDF with readable text (font resource included). */
function makePdf(text: string): Buffer {
  const lines = text.match(/[^.!?]+[.!?]*/g)?.map((line) => line.trim()) ?? [];
  const stream = `BT /F1 12 Tf 20 740 Td 0 -18 Td ${lines
    .map((line) => `(${line.replace(/[\\()]/g, '\\$&')}) Tj T*`)
    .join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  const offsets: number[] = [];
  let pdf = '%PDF-1.4\n';
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

/** A private pack with one pasted-text source, ready immediately. */
async function createPack(token: string) {
  const res = await request(app)
    .post('/api/study-packs')
    .set(auth(token))
    .send({
      title: 'Biologie H3',
      source: {
        type: 'text',
        title: 'Aantekeningen',
        text: 'De celkern bevat het DNA. Mitose deelt de celkern. Osmose verplaatst water.',
      },
    });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; sources: { id: string }[] };
}

async function waitForProcessing(token: string, packId: string, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app).get(`/api/study-packs/${packId}/processing`).set(auth(token));
    expect(res.status).toBe(200);
    if (!res.body.data.processing || Date.now() > deadline) return res.body.data;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

/** A real two-slide deck with speaker notes on slide 1. */
async function buildPptx(): Promise<Buffer> {
  const zip = new JSZip();
  const shape = (text: string, placeholder: string): string =>
    '<p:sp><p:nvSpPr><p:cNvPr id="1" name="S"/><p:nvPr>' +
    `<p:ph type="${placeholder}"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r>` +
    `<a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const slide = (shapes: string): string =>
    '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;

  zip.file('ppt/slides/slide1.xml', slide(shape('Celkern', 'title') + shape('De celkern bevat het DNA.', 'body')));
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" ' +
      'Target="../notesSlides/notesSlide1.xml"/></Relationships>',
  );
  zip.file(
    'ppt/notesSlides/notesSlide1.xml',
    '<?xml version="1.0" encoding="UTF-8"?><p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>' +
      shape('Celkern', 'title') +
      shape('Vraag de klas waarom de celkern belangrijk is.', 'body') +
      '</p:spTree></p:cSld></p:notes>',
  );
  zip.file('ppt/slides/slide2.xml', slide(shape('Mitose', 'title') + shape('Mitose is de deling van de celkern.', 'body')));
  zip.file(
    'ppt/slides/_rels/slide2.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

let token: string;

beforeEach(async () => {
  mutableConfig.groqApiKey = 'test-groq-key';
  importJobs.clear();
  createCompletion.mockReset();
  respondWithAi(OCR_TEXT);
  token = await signup();
});

describe('source upload: one endpoint for every file kind', () => {
  it('imports a PowerPoint and keeps the slide references', async () => {
    const deck = await buildPptx();

    const created = await request(app)
      .post('/api/study-packs/import/upload')
      .set(auth(token))
      .field('kind', 'powerpoint')
      .field('title', 'Biologie H3 slides')
      .attach('file', deck, {
        filename: 'Biologie H3.pptx',
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });

    expect(created.status).toBe(201);
    const packId = created.body.data.packId as string;
    const status = await waitForProcessing(token, packId);
    expect(status.status).toBe('ready');
    expect(status.sources[0]).toMatchObject({ kind: 'powerpoint', status: 'ready' });

    const detail = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    const source = detail.body.data.sources[0];
    expect(source.extractedBy).toBe('pptx-xml');
    expect(source.slideCount).toBe(2);
    expect(source.references.map((reference: { label: string }) => reference.label)).toEqual(
      expect.arrayContaining(['slide 1', 'slide 2']),
    );
    // Slide text and speaker notes are both part of the material.
    expect(detail.body.data.concepts.length).toBeGreaterThan(0);
  });

  it('imports a photo through OCR and stores only the text', async () => {
    const created = await request(app)
      .post('/api/study-packs/import/upload')
      .set(auth(token))
      .field('kind', 'image')
      .field('title', 'Foto van het bord')
      .attach('file', PNG, { filename: 'bord.png', contentType: 'image/png' });

    expect(created.status).toBe(201);
    const packId = created.body.data.packId as string;
    await waitForProcessing(token, packId);

    const detail = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    const source = detail.body.data.sources[0];
    expect(source.kind).toBe('image');
    expect(source.extractedBy).toBe('ocr');
    expect(source.status).toBe('ready');
    expect(source.characterCount).toBeGreaterThan(80);
  });

  it('imports a PDF through the same upload endpoint and keeps page references', async () => {
    const file = makePdf(
      'De celkern bevat het DNA en regelt wat de cel doet. Mitose deelt de celkern in twee kernen. Osmose verplaatst water door een membraan in de cel.',
    );

    const created = await request(app)
      .post('/api/study-packs/import/upload')
      .set(auth(token))
      .field('kind', 'pdf')
      .field('title', 'Biologie H3')
      .attach('file', file, { filename: 'Biologie H3.pdf', contentType: 'application/pdf' });

    expect(created.status).toBe(201);
    const packId = created.body.data.packId as string;
    const status = await waitForProcessing(token, packId);
    expect(status.status).toBe('ready');
    expect(status.sources[0]).toMatchObject({ kind: 'pdf', status: 'ready', retryable: true });

    const detail = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    const source = detail.body.data.sources[0];
    // The PDF is read server-side, and its provenance is a real page.
    expect(source.extractedBy).toBe('pdf-text');
    expect(source.pageCount).toBe(1);
    expect(source.references).toEqual([
      { marker: 'p1', kind: 'page', label: 'page 1' },
    ]);
    expect(source.warnings).toEqual([]);
    expect(detail.body.data.concepts.length).toBeGreaterThan(0);
    expect(detail.body.data.concepts[0].refLabel).toBe('page 1');
  });

  it('fails an unreadable photo honestly and keeps it retryable', async () => {
    respondWithAi(null);

    const created = await request(app)
      .post('/api/study-packs/import/upload')
      .set(auth(token))
      .field('kind', 'image')
      .field('title', 'Wazige foto')
      .attach('file', PNG, { filename: 'wazig.png', contentType: 'image/png' });

    expect(created.status).toBe(201);
    const packId = created.body.data.packId as string;
    const status = await waitForProcessing(token, packId);

    expect(status.sources[0].status).toBe('failed');
    expect(status.sources[0].failureReason).toBe(OCR_MESSAGE_NO_TEXT);
    expect(status.sources[0].failureReason).toContain("We couldn't detect enough text in this image.");
    expect(status.sources[0].retryable).toBe(true);
    // The pack itself survives: the student can retry or paste the text.
    expect((await request(app).get(`/api/study-packs/${packId}`).set(auth(token))).status).toBe(200);
  });
});

describe('source upload: validation', () => {
  it('adds a PDF to an existing pack through that same hardened path', async () => {
    const pack = await createPack(token);
    const file = makePdf('Mitose deelt de celkern in twee identieke kernen. Osmose verplaatst water.');

    const added = await request(app)
      .post(`/api/study-packs/${pack.id}/sources/upload`)
      .set(auth(token))
      .field('kind', 'pdf')
      .field('title', 'Lesnotities')
      .attach('file', file, { filename: 'lesnotities.pdf', contentType: 'application/pdf' });
    expect(added.status).toBe(202);

    const status = await waitForProcessing(token, pack.id);
    expect(status.sources.map((source: { kind: string; status: string }) => [source.kind, source.status])).toEqual([
      ['text', 'ready'],
      ['pdf', 'ready'],
    ]);

    const detail = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(token));
    expect(detail.body.data.sources[1]).toMatchObject({
      kind: 'pdf',
      title: 'Lesnotities',
      extractedBy: 'pdf-text',
    });
    expect(detail.body.data.sources[1].references).toEqual([
      { marker: 'p1', kind: 'page', label: 'page 1' },
    ]);
  });

  it('refuses a file that does not match the declared kind', async () => {
    const before = await request(app).get('/api/study-packs').set(auth(token));

    const response = await request(app)
      .post('/api/study-packs/import/upload')
      .set(auth(token))
      .field('kind', 'image')
      .field('title', 'Geen foto')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'document.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('That file type is not supported for image sources.');

    // Same file, but now with a MIME type that passes: the extension still stops it.
    const sneaky = await request(app)
      .post('/api/study-packs/import/upload')
      .set(auth(token))
      .field('kind', 'image')
      .field('title', 'Geen foto')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'document.pdf', contentType: 'image/png' });
    expect(sneaky.status).toBe(400);
    expect(sneaky.body.error.message).toBe('That file type does not match an image source.');

    const after = await request(app).get('/api/study-packs').set(auth(token));
    expect(after.body.data).toHaveLength(before.body.data.length);
  });

  it('refuses a PowerPoint uploaded as a PDF', async () => {
    const deck = await buildPptx();

    const response = await request(app)
      .post('/api/study-packs/import/upload')
      .set(auth(token))
      .field('kind', 'pdf')
      .field('title', 'Verkeerd')
      .attach('file', deck, { filename: 'deck.pptx', contentType: 'application/pdf' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('That file type does not match a pdf source.');
  });

  it('refuses an unsupported image type', async () => {
    const response = await request(app)
      .post('/api/study-packs/import/upload')
      .set(auth(token))
      .field('kind', 'image')
      .field('title', 'Gif')
      .attach('file', PNG, { filename: 'animatie.gif', contentType: 'image/gif' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('That file type is not supported for image sources.');
  });

  it('enforces the real byte limit of the declared kind', async () => {
    const tooBig = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(config.sourceMaxImageBytes + 1_024, 0x01)]);

    const response = await request(app)
      .post('/api/study-packs/import/upload')
      .set(auth(token))
      .field('kind', 'image')
      .field('title', 'Te groot')
      .attach('file', tooBig, { filename: 'groot.png', contentType: 'image/png' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/This file is too large\. The limit for image files is \d+ MB\./);
  });

  it('refuses an unknown kind instead of guessing one', async () => {
    const response = await request(app)
      .post('/api/study-packs/import/upload')
      .set(auth(token))
      .field('kind', 'spreadsheet')
      .field('title', 'Onbekend')
      .attach('file', PNG, { filename: 'iets.png', contentType: 'image/png' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('That file type does not match the source you are adding.');
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .post('/api/study-packs/import/upload')
      .field('kind', 'image')
      .field('title', 'Gast')
      .attach('file', PNG, { filename: 'bord.png', contentType: 'image/png' });

    expect(response.status).toBe(401);
    expect(createCompletion).not.toHaveBeenCalled();
  });
});
