/**
 * Source ingestion: material → Study Pack → content, end to end over the real
 * HTTP surface (in-memory database, mocked Groq client).
 *
 * These tests pin the promises the import flow makes:
 *  - pasted text and PDFs really become a pack with material and content
 *  - processing reports real stages, never fake progress
 *  - a missing or broken AI never loses the material or the pack
 *  - duplicate material is spotted before a second pack is created
 *  - every failure has a friendly message and a retry path
 *  - another student can never read or process your pack
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';
import { importJobs } from './lib/import-job-store.js';
import { IMPORT_STAGE_LABELS } from './services/study-pack-import.js';

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
  const email = `import${counter}-${Math.floor(Math.random() * 1e7)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: 'Import Student' });
  return res.body.data.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function completion(content: string): unknown {
  return {
    choices: [{ index: 0, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 300, completion_tokens: 120, total_tokens: 420 },
  };
}

const MATERIAL = [
  'Fotosynthese is het proces waarbij planten lichtenergie omzetten in glucose.',
  'Chlorofyl is de groene stof in bladgroenkorrels die licht opneemt.',
  'Mitose is de deling van de celkern waarbij twee identieke cellen ontstaan.',
  'Osmose is het verplaatsen van water door een halfdoorlatende membraan.',
  'Cellulose is een bouwstof in de celwand van plantencellen.',
].join(' ');

/**
 * Answers each Study Pack AI task with valid JSON. The runner is asked for one
 * task at a time and may retry an invalid answer, so the mock reacts to the
 * requested action instead of call order — exactly like the real provider.
 */
function respondWithGeneration(
  overrides: Partial<Record<'concepts' | 'summary' | 'flashcards' | 'practice', unknown>> = {},
): void {
  const answers: Record<string, unknown> = {
    'key concepts': {
      concepts: [
        {
          name: 'Fotosynthese',
          explanation: 'Planten maken glucose met lichtenergie.',
          sourceRef: 1,
        },
        { name: 'Chlorofyl', explanation: 'Groene stof die licht opneemt.', sourceRef: 1 },
        { name: 'Osmose', explanation: 'Water verplaatst door een membraan.', sourceRef: 1 },
      ],
      ...(overrides.concepts as object | undefined),
    },
    summary: {
      title: 'Biologie H3',
      summary: 'Planten zetten lichtenergie om in glucose; water verplaatst zich door membranen.',
      keyPoints: ['Fotosynthese', 'Osmose', 'Chlorofyl'],
      terms: [{ term: 'Chlorofyl', definition: 'Groene stof in bladgroenkorrels.' }],
      ...(overrides.summary as object | undefined),
    },
    flashcards: {
      title: 'Cellbiologie',
      description: 'Kaarten over fotosynthese en transport.',
      cards: [
        { front: 'Wat doet chlorofyl?', back: 'Het neemt licht op.' },
        { front: 'Wat is osmose?', back: 'Waterverplaatsing door een membraan.' },
      ],
      ...(overrides.flashcards as object | undefined),
    },
    'practice questions': {
      questions: [
        {
          type: 'multiple_choice',
          question: 'Waaruit bestaat de celwand van planten?',
          options: ['Cellulose', 'Chlorofyl', 'Glucose', 'Water'],
          correctIndex: 0,
          answer: 'Cellulose',
          explanation: 'Cellulose is een bouwstof.',
        },
      ],
      ...(overrides.practice as object | undefined),
    },
  };

  createCompletion.mockImplementation((params: { messages: { content: string }[] }) => {
    const payload = params.messages.map((message) => message.content).join('\n');
    const action = Object.keys(answers).find((key) => payload.includes(`"action":"${key}"`));
    return Promise.resolve(completion(JSON.stringify(action ? answers[action] : {})));
  });
}

/** Runs a job to completion; the runner is fire-and-forget by design. */
async function waitForProcessing(token: string, packId: string, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app).get(`/api/study-packs/${packId}/processing`).set(auth(token));
    expect(res.status).toBe(200);
    if (!res.body.data.processing || Date.now() > deadline) return res.body.data;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

async function importText(token: string, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/study-packs/import')
    .set(auth(token))
    .send({
      title: 'Biologie H3 — Cellen',
      level: '3 MAVO',
      source: { type: 'text', title: 'Biologie H3 aantekeningen', text: MATERIAL },
      ...overrides,
    });
}

function makePdf(text?: string): Buffer {
  const lines = text ? (text.match(/[^.!?]+[.!?]*/g)?.map((line) => line.trim()) ?? []) : [];
  const stream = lines.length
    ? `BT /F1 12 Tf 20 740 Td 0 -18 Td ${lines
        .map((line) => `(${line.replace(/[\\()]/g, '\\$&')}) Tj T*`)
        .join(' ')} ET`
    : 'q Q';
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

beforeEach(() => {
  mutableConfig.groqApiKey = 'test-groq-key';
  createCompletion.mockReset();
  importJobs.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('material import: pasted text', () => {
  it('creates a study pack with content and reports real processing stages', async () => {
    const token = await signup();
    respondWithGeneration();

    const res = await importText(token);
    expect(res.status).toBe(201);
    const { packId, status } = res.body.data;
    expect(packId).toBeTruthy();
    expect(status.processing).toBe(true);
    // The stages the student will actually watch, in the order they run.
    expect(status.steps.map((step: { id: string }) => step.id)).toEqual([
      'concepts',
      'summary',
      'flashcards',
      'practice',
      'plan',
    ]);
    expect(status.steps.every((step: { label: string }) => Boolean(step.label))).toBe(true);
    expect(Object.values(IMPORT_STAGE_LABELS)).toContain(status.steps[0].label);

    const finished = await waitForProcessing(token, packId);
    expect(finished.processing).toBe(false);
    expect(finished.status).toBe('ready');
    expect(finished.counts.concepts).toBeGreaterThan(0);
    expect(finished.counts.flashcards).toBe(2);
    expect(finished.counts.practiceQuestions).toBe(1);
    expect(finished.counts.hasSummary).toBe(true);
    expect(finished.counts.hasPlan).toBe(true);

    // The pack is complete and study-ready — never an empty page.
    const detail = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.counts.concepts).toBe(3);
    expect(detail.body.data.counts.flashcards).toBe(2);
    expect(detail.body.data.counts.practiceQuestions).toBe(1);
    expect(detail.body.data.summary).toContain('lichtenergie');
    expect(detail.body.data.studyPlan).not.toBeNull();
    expect(detail.body.data.sources[0].status).toBe('ready');
    expect(detail.body.data.sources[0].kind).toBe('text');
    expect(detail.body.data.aiAvailable).toBe(true);
  });

  it('keeps generated content traceable to the source it came from', async () => {
    const token = await signup();
    respondWithGeneration();

    const res = await importText(token);
    const packId = res.body.data.packId as string;
    await waitForProcessing(token, packId);

    const detail = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    const sourceId = detail.body.data.sources[0].id as string;
    for (const concept of detail.body.data.concepts) {
      expect(concept.sourceId).toBe(sourceId);
      expect(concept.sourceTitle).toBe('Biologie H3 aantekeningen');
    }

    // Flashcards carry the same provenance, so "Generated from" stays possible.
    const set = await request(app)
      .get(`/api/sets/${detail.body.data.legacySetId}`)
      .set(auth(token));
    for (const card of set.body.data.cards) {
      expect(card.sourceId).toBe(sourceId);
    }
  });

  it('shows the new pack in My Study right away', async () => {
    const token = await signup();
    respondWithGeneration();
    const res = await importText(token);
    const packId = res.body.data.packId as string;
    await waitForProcessing(token, packId);

    const list = await request(app).get('/api/study-packs').set(auth(token));
    expect(list.body.data.map((pack: { id: string }) => pack.id)).toContain(packId);

    const today = await request(app).get('/api/study-packs/today').set(auth(token));
    expect(today.body.data.packs.map((pack: { id: string }) => pack.id)).toContain(packId);
    expect(today.body.data.totalDue).toBe(0);
    expect(today.body.data.packs[0].masteryPercent).toBe(0);
  });

  it('rejects material that is too short to study', async () => {
    const token = await signup();
    const res = await importText(token, {
      source: { type: 'text', title: 'Leeg', text: 'te kort' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('imports an existing Lerno set without padding the student’s own cards', async () => {
    const token = await signup();
    const set = await request(app)
      .post('/api/sets')
      .set(auth(token))
      .send({
        title: 'Eigen kaarten',
        cards: [
          { question: 'Wat is DNA?', answer: 'Erfelijk materiaal.' },
          { question: 'Wat is RNA?', answer: 'Boodschapper bij eiwitsynthese.' },
        ],
      });
    respondWithGeneration();

    const res = await request(app)
      .post('/api/study-packs/import')
      .set(auth(token))
      .send({ title: 'Eigen kaarten', source: { type: 'set', setId: set.body.data.id } });
    expect(res.status).toBe(201);

    const packId = res.body.data.packId as string;
    const finished = await waitForProcessing(token, packId);
    expect(finished.status).toBe('ready');
    // The student's own cards are never padded: flashcards are not generated.
    expect(finished.steps.map((step: { id: string }) => step.id)).not.toContain('flashcards');

    const detail = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    expect(detail.body.data.counts.flashcards).toBe(2);
    expect(detail.body.data.sources[0].kind).toBe('set');
  });
});

describe('material import: AI availability', () => {
  it('still creates the pack and the material when AI is not configured', async () => {
    const token = await signup();
    mutableConfig.groqApiKey = '';

    const res = await importText(token);
    expect(res.status).toBe(201);
    const packId = res.body.data.packId as string;

    const finished = await waitForProcessing(token, packId);
    expect(finished.status).toBe('ready');
    expect(finished.aiAvailable).toBe(false);
    expect(finished.aiSkipped).toBe(true);
    expect(finished.counts.concepts).toBe(0);
    // The deterministic study plan never needs AI.
    expect(finished.counts.hasPlan).toBe(true);
    expect(
      finished.steps
        .filter((step: { id: string }) => step.id !== 'plan')
        .every((step: { state: string }) => step.state === 'skipped'),
    ).toBe(true);

    const detail = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    expect(detail.body.data.aiAvailable).toBe(false);
    expect(detail.body.data.sources[0].status).toBe('ready');
    expect(detail.body.data.sources[0].characterCount).toBeGreaterThan(50);
    expect(detail.body.data.studyPlan).not.toBeNull();
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('keeps a failed generation recoverable: friendly message, details and retry', async () => {
    const token = await signup();
    createCompletion.mockRejectedValue(new Error('upstream exploded'));

    const res = await importText(token);
    const packId = res.body.data.packId as string;
    const failed = await waitForProcessing(token, packId);

    expect(failed.status).toBe('failed');
    expect(failed.failure?.message).toBeTruthy();
    expect(failed.failure?.message).not.toMatch(/upstream|stack|Error:/i);
    expect(failed.failure?.details).toContain('Stage: concepts');

    // Nothing is lost: the pack and its source still exist and can be retried.
    const detail = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.sources[0].status).toBe('failed');
    expect(detail.body.data.sources[0].failureReason).toBeTruthy();

    createCompletion.mockReset();
    respondWithGeneration();
    const retry = await request(app)
      .post(`/api/study-packs/${packId}/process`)
      .set(auth(token))
      .send({});
    expect(retry.status).toBe(202);

    const retried = await waitForProcessing(token, packId);
    expect(retried.status).toBe('ready');
    expect(retried.counts.concepts).toBeGreaterThan(0);
    expect(retried.failure).toBeNull();

    const recovered = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    expect(recovered.body.data.sources[0].status).toBe('ready');
  });

  it('lets AI be used later on material that was imported while it was down', async () => {
    const token = await signup();
    mutableConfig.groqApiKey = '';
    const res = await importText(token);
    const packId = res.body.data.packId as string;
    await waitForProcessing(token, packId);

    mutableConfig.groqApiKey = 'test-groq-key';
    respondWithGeneration();
    const started = await request(app)
      .post(`/api/study-packs/${packId}/process`)
      .set(auth(token))
      .send({});
    expect(started.status).toBe(202);

    const finished = await waitForProcessing(token, packId);
    expect(finished.aiAvailable).toBe(true);
    expect(finished.counts.concepts).toBeGreaterThan(0);
    expect(finished.counts.flashcards).toBeGreaterThan(0);
  });

  it('appends on a later run and never drops or silently replaces content', async () => {
    const token = await signup();
    respondWithGeneration();
    const res = await importText(token);
    const packId = res.body.data.packId as string;
    await waitForProcessing(token, packId);

    const before = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    const namesBefore = before.body.data.concepts.map((c: { name: string }) => c.name);
    const cardsBefore = before.body.data.counts.flashcards as number;
    const questionsBefore = before.body.data.counts.practiceQuestions as number;

    // A second run proposes one new concept, one duplicate and one new card.
    createCompletion.mockReset();
    respondWithGeneration({
      concepts: [
        { name: 'Celwand', explanation: 'Stevige laag om de plantencel.', sourceRef: 1 },
        { name: 'Celwand', explanation: 'Stevige laag om de plantencel.', sourceRef: 1 },
        { name: 'Bladgroenkorrel', explanation: 'Plaats waar fotosynthese gebeurt.', sourceRef: 1 },
      ],
      flashcards: {
        title: 'Extra',
        description: '',
        cards: [{ front: 'Wat is mitose?', back: 'Deling van de celkern.' }],
      },
      practice: { questions: [] },
    });
    await request(app).post(`/api/study-packs/${packId}/process`).set(auth(token)).send({});
    await waitForProcessing(token, packId);

    const after = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    const namesAfter = after.body.data.concepts.map((c: { name: string }) => c.name);
    // Nothing that existed before is gone.
    for (const name of namesBefore) expect(namesAfter).toContain(name);
    expect(after.body.data.counts.flashcards).toBe(cardsBefore + 1);
    expect(after.body.data.counts.practiceQuestions).toBe(questionsBefore);
  });
});

describe('material import: PDF', () => {
  it('reads a real PDF and returns what Lerno found, without storing anything yet', async () => {
    const token = await signup();

    const res = await request(app)
      .post('/api/study-packs/import/pdf')
      .set(auth(token))
      .attach('file', makePdf(MATERIAL), {
        filename: 'Biologie H3.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(201);
    const preview = res.body.data;
    expect(preview.title).toBe('Biologie H3');
    expect(preview.pageCount).toBe(1);
    expect(preview.wordCount).toBeGreaterThan(20);
    expect(preview.characterCount).toBeGreaterThan(50);
    expect(preview.concepts.length).toBeGreaterThan(0);
    expect(preview.concepts[0].name).toBeTruthy();
    expect(preview.concepts[0].explanation.length).toBeGreaterThan(10);
    expect(preview.text).toContain('Fotosynthese');

    // Preview only: no pack was created and nothing is in the library.
    const list = await request(app).get('/api/study-packs').set(auth(token));
    expect(list.body.data).toEqual([]);
  });

  it('turns the reviewed PDF into a study pack through the same import endpoint', async () => {
    const token = await signup();
    respondWithGeneration();

    const preview = await request(app)
      .post('/api/study-packs/import/pdf')
      .set(auth(token))
      .attach('file', makePdf(MATERIAL), {
        filename: 'Biologie H3.pdf',
        contentType: 'application/pdf',
      });

    const res = await request(app)
      .post('/api/study-packs/import')
      .set(auth(token))
      .send({
        title: 'Biologie H3 — Cellen',
        level: '3 MAVO',
        source: {
          type: 'pdf',
          title: 'Biologie H3.pdf',
          text: preview.body.data.text,
          pageCount: preview.body.data.pageCount,
        },
      });
    expect(res.status).toBe(201);

    const packId = res.body.data.packId as string;
    await waitForProcessing(token, packId);
    const detail = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    expect(detail.body.data.sources[0].kind).toBe('pdf');
    expect(detail.body.data.sources[0].pageCount).toBe(1);
    expect(detail.body.data.counts.concepts).toBeGreaterThan(0);
  });

  it('refuses files that are not PDFs and PDFs without readable text', async () => {
    const token = await signup();

    const notPdf = await request(app)
      .post('/api/study-packs/import/pdf')
      .set(auth(token))
      .attach('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(notPdf.status).toBe(400);
    expect(notPdf.body.error.message).toMatch(/PDF/i);

    const fakePdf = await request(app)
      .post('/api/study-packs/import/pdf')
      .set(auth(token))
      .attach('file', Buffer.from('not a pdf at all'), {
        filename: 'fake.pdf',
        contentType: 'application/pdf',
      });
    expect(fakePdf.status).toBe(400);
    expect(fakePdf.body.error.message).toMatch(/not a valid PDF/i);

    const scanned = await request(app)
      .post('/api/study-packs/import/pdf')
      .set(auth(token))
      .attach('file', makePdf(), { filename: 'scan.pdf', contentType: 'application/pdf' });
    expect(scanned.status).toBe(400);
    expect(scanned.body.error.message).toMatch(/no readable selectable text|paste the text/i);
  });

  it('requires authentication for both the preview and the import', async () => {
    const preview = await request(app)
      .post('/api/study-packs/import/pdf')
      .attach('file', makePdf(MATERIAL), 'notes.pdf');
    expect(preview.status).toBe(401);

    const created = await request(app)
      .post('/api/study-packs/import')
      .send({ title: 'x', source: { type: 'text', title: 'y', text: MATERIAL } });
    expect(created.status).toBe(401);
  });
});

describe('material import: duplicates', () => {
  it('warns about the same material and can open the existing pack or import anyway', async () => {
    const token = await signup();
    respondWithGeneration();
    const first = await importText(token);
    expect(first.status).toBe(201);
    const packId = first.body.data.packId as string;
    await waitForProcessing(token, packId);

    // Same text, different title/whitespace: still the same material.
    const duplicate = await importText(token, {
      title: 'Nog een keer',
      source: { type: 'text', title: 'Biologie H3 aantekeningen', text: `  ${MATERIAL}\n\n` },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
    expect(duplicate.body.error.details).toMatchObject({
      reason: 'duplicate-source',
      packId,
      packTitle: 'Biologie H3 — Cellen',
    });

    const forced = await importText(token, {
      title: 'Bewust nog een keer',
      allowDuplicate: true,
      source: { type: 'text', title: 'Biologie H3 aantekeningen', text: MATERIAL },
    });
    expect(forced.status).toBe(201);
    expect(forced.body.data.packId).not.toBe(packId);
  });

  it('does not flag different material', async () => {
    const token = await signup();
    respondWithGeneration();
    await request(app)
      .post('/api/study-packs/import')
      .set(auth(token))
      .send({
        title: 'Wiskunde',
        source: {
          type: 'text',
          title: 'Wiskunde H2',
          text: 'Een driehoek heeft drie hoeken en de hoeken zijn samen 180 graden.',
        },
      });

    const other = await importText(token);
    expect(other.status).toBe(201);
  });
});

describe('material import: ownership and safety', () => {
  it('never exposes another student’s processing or pack', async () => {
    const owner = await signup();
    const stranger = await signup();
    respondWithGeneration();
    const res = await importText(owner);
    const packId = res.body.data.packId as string;

    const status = await request(app)
      .get(`/api/study-packs/${packId}/processing`)
      .set(auth(stranger));
    expect(status.status).toBe(404);

    const retry = await request(app)
      .post(`/api/study-packs/${packId}/process`)
      .set(auth(stranger))
      .send({});
    expect(retry.status).toBe(404);

    const guest = await request(app).get(`/api/study-packs/${packId}/processing`);
    expect(guest.status).toBe(401);
  });

  it('strips control characters from imported material before storing it', async () => {
    const token = await signup();
    respondWithGeneration();
    const noisy = `\u0000\u0007Fotosynthese\u0008 is het proces waarbij planten lichtenergie omzetten in glucose. ${MATERIAL}`;

    const res = await importText(token, {
      source: { type: 'text', title: 'Vies bestand', text: noisy },
    });
    expect(res.status).toBe(201);

    const detail = await request(app)
      .get(`/api/study-packs/${res.body.data.packId}`)
      .set(auth(token));
    const source = detail.body.data.sources[0];
    expect(source.characterCount).toBeGreaterThan(50);
    const probe = await request(app)
      .get(`/api/study-packs/${res.body.data.packId}`)
      .set(auth(token));
    expect(JSON.stringify(probe.body.data.sources)).not.toMatch(/\\u0000|\\u0007|\\u0008/);
  });

  it('bounds one student to a single import at a time', async () => {
    const token = await signup();
    // Never resolves: the first import stays in flight.
    createCompletion.mockImplementation(() => new Promise(() => {}));

    const first = await importText(token);
    expect(first.status).toBe(201);
    const second = await importText(token, {
      title: 'Tweede',
      source: {
        type: 'text',
        title: 'Iets anders',
        text: 'Een heel andere tekst over vulkanen en lava en aswolken boven IJsland.',
      },
    });
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('RATE_LIMITED');

    importJobs.clear();
  });
});
