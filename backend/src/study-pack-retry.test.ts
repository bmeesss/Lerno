/**
 * Retry: every failure keeps the material, points at the stage that failed, and
 * can be retried without uploading anything again or duplicating content.
 *
 * The mocked provider lets us break exactly one stage at a time, which is what
 * these tests need: a transcription that fails, a generation that fails, a stored
 * state left behind by a failed review.
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';
import { getMemoryState } from './lib/db/index.js';
import { importJobs } from './lib/import-job-store.js';

const { createCompletion, createTranscription } = vi.hoisted(() => ({
  createCompletion: vi.fn(),
  createTranscription: vi.fn(),
}));

vi.mock('groq-sdk', () => {
  class Groq {
    chat = { completions: { create: createCompletion } };
    audio = { transcriptions: { create: createTranscription } };
    constructor(_options: unknown) {}
  }
  return { default: Groq };
});

const mutableConfig = config as unknown as { groqApiKey: string };
const app = createApp();

let counter = 0;

async function signup(): Promise<string> {
  counter += 1;
  const email = `retry${counter}-${Math.floor(Math.random() * 1e7)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: 'Retry Student' });
  return res.body.data.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const MATERIAL = [
  'Fotosynthese is het proces waarbij planten lichtenergie omzetten in glucose.',
  'Chlorofyl is de groene stof in bladgroenkorrels die licht opneemt.',
  'Mitose is de deling van de celkern waarbij twee identieke cellen ontstaan.',
  'Osmose is het verplaatsen van water door een halfdoorlatende membraan.',
  'Cellulose is een bouwstof in de celwand van plantencellen.',
].join(' ');

function completion(content: string): unknown {
  return {
    choices: [{ index: 0, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 300, completion_tokens: 120, total_tokens: 420 },
  };
}

const ANSWERS: Record<string, unknown> = {
  analysis: {
    summary: 'Planten zetten lichtenergie om in glucose; water verplaatst zich door membranen.',
    keyFacts: [
      'Fotosynthese gebruikt lichtenergie.',
      'Osmose verplaatst water door een membraan.',
    ],
    relationships: ['Chlorofyl is nodig voor fotosynthese.'],
    examTopics: ['Fotosynthese'],
    difficulty: 'medium',
    sections: [{ title: 'Cellen', ref: '1:p1' }],
    conflicts: [],
  },
  concepts: {
    concepts: [
      { name: 'Fotosynthese', explanation: 'Planten maken glucose met lichtenergie.', ref: '1:p1' },
      { name: 'Chlorofyl', explanation: 'Groene stof die licht opneemt in de cel.', ref: '1:p1' },
      { name: 'Osmose', explanation: 'Water verplaatst door een halfdoorlatende membraan.', ref: '1:p1' },
    ],
  },
  summary: {
    title: 'Biologie H3',
    summary: 'Planten zetten lichtenergie om in glucose.',
    keyPoints: ['Fotosynthese', 'Osmose'],
  },
  flashcards: {
    title: 'Cellbiologie',
    description: 'Kaarten over fotosynthese.',
    cards: [{ front: 'Wat doet chlorofyl?', back: 'Het neemt licht op.', ref: '1:p1', conceptRef: 1 }],
  },
  practice: {
    questions: [
      {
        type: 'open',
        question: 'Wat is osmose in één zin?',
        answer: 'Waterverplaatsing door een membraan.',
        explanation: 'Osmose verplaatst water.',
        ref: '1:p1',
        conceptRef: 3,
      },
    ],
  },
};

/** Answers every task with valid JSON; `failOn` breaks exactly one task. */
function respondWithGeneration(failOn?: string): void {
  createCompletion.mockImplementation((params: { messages: { content: string }[] }) => {
    const payload = params.messages.map((message) => message.content).join('\n');
    const task = Object.keys(ANSWERS).find((key) => payload.includes(`"task":"${key}"`));
    if (failOn && task === failOn) return Promise.reject(new Error('upstream exploded'));
    return Promise.resolve(completion(JSON.stringify(task ? ANSWERS[task] : {})));
  });
}

const TRANSCRIPT = {
  text: 'De celkern bevat het DNA en regelt de celdeling in de cel.',
  language: 'nl',
  duration: 480,
  segments: [
    { start: 0, end: 6, text: 'De celkern bevat het DNA' },
    { start: 222, end: 228, text: 'en regelt de celdeling in de cel.' },
  ],
};

async function waitForProcessing(token: string, packId: string, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app).get(`/api/study-packs/${packId}/processing`).set(auth(token));
    expect(res.status).toBe(200);
    if (!res.body.data.processing || Date.now() > deadline) return res.body.data;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

async function importText(token: string) {
  return request(app)
    .post('/api/study-packs/import')
    .set(auth(token))
    .send({
      title: 'Biologie H3 — Cellen',
      level: '3 MAVO',
      source: { type: 'text', title: 'Biologie H3 aantekeningen', text: MATERIAL },
    });
}

/** A minimal but real mp3 container: ID3 header, then bytes. */
const MP3 = Buffer.concat([Buffer.from('ID3\u0003\u0000', 'ascii'), Buffer.alloc(1_024, 0x11)]);

beforeEach(() => {
  mutableConfig.groqApiKey = 'test-groq-key';
  createCompletion.mockReset();
  createTranscription.mockReset();
  importJobs.clear();
  respondWithGeneration();
  createTranscription.mockResolvedValue(TRANSCRIPT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('retry: a failed extraction', () => {
  it('keeps the uploaded file, retries the same source and never asks for a second upload', async () => {
    const token = await signup();
    createTranscription.mockRejectedValue(Object.assign(new Error('whisper down'), { status: 500 }));

    const created = await request(app)
      .post('/api/study-packs/import/upload')
      .set(auth(token))
      .field('kind', 'audio')
      .field('title', 'Les celdeling')
      .attach('file', MP3, { filename: 'les-3.mp3', contentType: 'audio/mpeg' });
    expect(created.status).toBe(201);
    const packId = created.body.data.packId as string;

    const failed = await waitForProcessing(token, packId);
    expect(failed.status).toBe('failed');
    expect(failed.failure?.message).toBe(
      "We couldn't transcribe this recording. The audio is saved — try again, or paste the text instead.",
    );
    expect(failed.failure?.details).toContain('Stage: extract');
    const brokenSource = failed.sources[0];
    expect(brokenSource.status).toBe('failed');
    expect(brokenSource.stage).toBe('extract');
    // The file is still held for a retry, so no second upload is needed.
    expect(brokenSource.retryable).toBe(true);

    createTranscription.mockResolvedValue(TRANSCRIPT);
    const retry = await request(app)
      .post(`/api/study-packs/${packId}/process`)
      .set(auth(token))
      .send({ sourceId: brokenSource.id, stage: 'extract' });
    expect(retry.status).toBe(202);

    const recovered = await waitForProcessing(token, packId);
    expect(recovered.status).toBe('ready');
    expect(recovered.failure).toBeNull();
    expect(recovered.sources).toHaveLength(1);
    expect(recovered.sources[0]?.id).toBe(brokenSource.id);
    expect(recovered.sources[0]?.status).toBe('ready');

    const detail = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    // One source, its transcript stored with real timestamps, and no duplicates.
    expect(detail.body.data.sources).toHaveLength(1);
    expect(detail.body.data.sources[0].characterCount).toBeGreaterThan(40);
    expect(detail.body.data.sources[0].references).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: '3:42 in recording' })]),
    );
  });
});

describe('retry: a failed generation', () => {
  it('resumes at generation, adds the missing content once and keeps the analysis', async () => {
    const token = await signup();
    respondWithGeneration('flashcards');

    const created = await importText(token);
    expect(created.status).toBe(201);
    const packId = created.body.data.packId as string;

    const failed = await waitForProcessing(token, packId);
    // The reading and the analysis worked, so the pack is usable: only the
    // generation failed and it is reported as exactly that.
    expect(failed.status).toBe('partial');
    expect(failed.failure?.details).toContain('Stage: generate');
    expect(failed.counts.concepts).toBeGreaterThan(0);
    expect(failed.counts.flashcards).toBe(0);

    respondWithGeneration();
    const retry = await request(app)
      .post(`/api/study-packs/${packId}/process`)
      .set(auth(token))
      .send({});
    expect(retry.status).toBe(202);

    const recovered = await waitForProcessing(token, packId);
    expect(recovered.status).toBe('ready');
    expect(recovered.failure).toBeNull();
    expect(recovered.counts.flashcards).toBeGreaterThan(0);
    expect(recovered.counts.practiceQuestions).toBeGreaterThan(0);
    // The retry re-ran generation, not the reading or the analysis.
    expect(recovered.counts.concepts).toBe(failed.counts.concepts);
  });

  it('retries exactly the requested stage', async () => {
    const token = await signup();
    const created = await importText(token);
    const packId = created.body.data.packId as string;
    await waitForProcessing(token, packId);

    const retry = await request(app)
      .post(`/api/study-packs/${packId}/process`)
      .set(auth(token))
      .send({ stage: 'generate' });

    expect(retry.status).toBe(202);
    expect(retry.body.data.steps.map((step: { id: string }) => step.id)).toEqual([
      'generate',
      'review',
      'plan',
    ]);
  });

  it('never doubles the content when the whole pipeline runs again', async () => {
    const token = await signup();
    const created = await importText(token);
    const packId = created.body.data.packId as string;
    const first = await waitForProcessing(token, packId);
    expect(first.status).toBe('ready');

    await request(app).post(`/api/study-packs/${packId}/process`).set(auth(token)).send({});
    const second = await waitForProcessing(token, packId);

    expect(second.counts.concepts).toBe(first.counts.concepts);
    expect(second.counts.flashcards).toBe(first.counts.flashcards);
    expect(second.counts.practiceQuestions).toBe(first.counts.practiceQuestions);
    // The content the second run could not add is reported instead of hidden.
    expect(second.counts.rejected).toBeGreaterThan(0);

    const detail = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    const cards = await request(app)
      .get(`/api/sets/${detail.body.data.legacySetId}/cards`)
      .set(auth(token));
    const fronts = cards.body.data.map((card: { question: string }) => card.question);
    expect(fronts.length).toBe(second.counts.flashcards);
    expect(new Set(fronts).size).toBe(fronts.length);
  });
});

describe('retry: a failed review', () => {
  it('reuses the stored material and finishes from the review stage', async () => {
    const token = await signup();
    const created = await importText(token);
    const packId = created.body.data.packId as string;
    const first = await waitForProcessing(token, packId);

    // Exactly what a failed review leaves behind: the material is stored and the
    // analysis exists, only the last stage did not finish.
    const sourceId = first.sources[0].id as string;
    const stored = getMemoryState().packSources.get(sourceId)!;
    stored.status = 'failed';
    stored.failureReason = 'Something went wrong while checking the content.';
    stored.processingStage = 'review';

    const retry = await request(app)
      .post(`/api/study-packs/${packId}/process`)
      .set(auth(token))
      .send({ sourceId });
    expect(retry.status).toBe(202);
    expect(retry.body.data.steps.map((step: { id: string }) => step.id)).toEqual(['review', 'plan']);

    const recovered = await waitForProcessing(token, packId);
    expect(recovered.status).toBe('ready');
    expect(recovered.failure).toBeNull();
    expect(recovered.sources).toHaveLength(1);
    expect(recovered.counts.concepts).toBe(first.counts.concepts);
    expect(recovered.counts.flashcards).toBe(first.counts.flashcards);

    const detail = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    // One source, one summary: a retry never stored a second copy of anything.
    expect(detail.body.data.sources).toHaveLength(1);
    expect(detail.body.data.concepts).toHaveLength(first.counts.concepts);
  });

  it('keeps content the student already approved', async () => {
    const token = await signup();
    const created = await importText(token);
    const packId = created.body.data.packId as string;
    await waitForProcessing(token, packId);

    const approved = await request(app)
      .post(`/api/study-packs/${packId}/content`)
      .set(auth(token))
      .send({
        target: 'flashcards',
        cards: [{ front: 'Wat is de celwand van een plant?', back: 'Cellulose.' }],
      });
    expect(approved.status).toBe(201);

    await request(app).post(`/api/study-packs/${packId}/process`).set(auth(token)).send({});
    const after = await waitForProcessing(token, packId);

    const detail = await request(app).get(`/api/study-packs/${packId}`).set(auth(token));
    const cards = await request(app)
      .get(`/api/sets/${detail.body.data.legacySetId}/cards`)
      .set(auth(token));
    const fronts = cards.body.data.map((card: { question: string }) => card.question);
    expect(fronts).toContain('Wat is de celwand van een plant?');
    expect(after.status).toBe('ready');
  });
});
