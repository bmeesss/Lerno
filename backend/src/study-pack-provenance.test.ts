/**
 * Provenance: every generated item can be traced back to the place it came from,
 * and a reference Lerno cannot verify is dropped instead of shown.
 *
 * Covers the three content types (concept, flashcard, practice question), the
 * fallback for material without inner structure, multi-source material where the
 * model must keep the sources apart, and conflicts between sources — which are
 * never silently merged.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';
import { getMemoryState } from './lib/db/index.js';
import { importJobs } from './lib/import-job-store.js';
import { resolveItemSource } from './services/source-analysis.js';
import { buildSourceContext, normalizePlainText } from './services/source-normalize.js';

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
  const email = `prov${counter}-${Math.floor(Math.random() * 1e7)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: 'Provenance Student' });
  return res.body.data.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function completion(content: string): unknown {
  return {
    choices: [{ index: 0, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
  };
}

const MATERIAL = [
  'Fotosynthese is het proces waarbij planten lichtenergie omzetten in glucose.',
  'Chlorofyl is de groene stof in bladgroenkorrels die licht opneemt.',
  'Mitose is de deling van de celkern waarbij twee identieke cellen ontstaan.',
  'Osmose is het verplaatsen van water door een halfdoorlatende membraan.',
].join(' ');

async function createPack(token: string) {
  const res = await request(app)
    .post('/api/study-packs')
    .set(auth(token))
    .send({
      title: 'Biologie H3',
      level: '3 MAVO',
      source: { type: 'text', title: 'Biologie H3 aantekeningen', text: MATERIAL },
    });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function waitForProcessing(token: string, packId: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app).get(`/api/study-packs/${packId}/processing`).set(auth(token));
    expect(res.status).toBe(200);
    if (!res.body.data.processing || Date.now() > deadline) return res.body.data;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

beforeEach(() => {
  mutableConfig.groqApiKey = 'test-groq-key';
  importJobs.clear();
  createCompletion.mockReset();
});

describe('provenance: resolving a marker', () => {
  const pdf = normalizePlainText(
    { sourceId: 'source-a', title: 'Biologie H3.pdf', kind: 'pdf', text: 'Mitose deelt de celkern.' },
    {
      referenceKind: 'page',
      references: [
        { marker: 'p1', kind: 'page', label: 'page 1', start: 0, page: 1, slide: null, startSeconds: null, endSeconds: null },
        { marker: 'p6', kind: 'page', label: 'page 6', start: 6, page: 6, slide: null, startSeconds: null, endSeconds: null },
      ],
    },
  );
  const notes = normalizePlainText({
    sourceId: 'source-b',
    title: 'Lesnotities',
    kind: 'text',
    text: 'Osmose verplaatst water door een membraan in de cel.',
  });

  it('prefers the verified marker', () => {
    const context = buildSourceContext([pdf, notes], { maxChars: 4_000 });

    expect(resolveItemSource(context, '1:p6', context.usedSourceIds)).toEqual({
      sourceId: 'source-a',
      refLabel: 'page 6',
    });
  });

  it('attributes an item to the notes when the model points at the notes', () => {
    const context = buildSourceContext([pdf, notes], { maxChars: 4_000 });

    // The source-level token is real provenance: the source, without an inner place.
    expect(resolveItemSource(context, '2:x1', context.usedSourceIds)).toEqual({
      sourceId: 'source-b',
      refLabel: null,
    });
  });

  it('drops an invented marker when several sources are in play', () => {
    const context = buildSourceContext([pdf, notes], { maxChars: 4_000 });

    expect(resolveItemSource(context, '3:p9', context.usedSourceIds)).toEqual({
      sourceId: null,
      refLabel: null,
    });
    expect(resolveItemSource(context, null, context.usedSourceIds)).toEqual({
      sourceId: null,
      refLabel: null,
    });
  });

  it('still attributes an unmarked item when there is only one source', () => {
    const context = buildSourceContext([pdf], { maxChars: 4_000 });

    expect(resolveItemSource(context, 'verzonnen', context.usedSourceIds)).toEqual({
      sourceId: 'source-a',
      refLabel: null,
    });
  });
});

describe('provenance: what is stored per content type', () => {
  it('keeps source and reference on concepts, and relations on cards and questions', async () => {
    const token = await signup();
    const pack = await createPack(token);
    const sourceId = pack.sources[0].id as string;

    const concepts = await request(app)
      .post(`/api/study-packs/${pack.id}/content`)
      .set(auth(token))
      .send({
        target: 'concepts',
        concepts: [
          {
            name: 'Mitose',
            explanation: 'Mitose is de deling van de celkern.',
            sourceId,
            refLabel: 'page 6',
          },
        ],
      });
    expect(concepts.status).toBe(201);
    const conceptId = concepts.body.data.concepts[0].id as string;

    const cards = await request(app)
      .post(`/api/study-packs/${pack.id}/content`)
      .set(auth(token))
      .send({
        target: 'flashcards',
        cards: [
          {
            front: 'Wat is mitose?',
            back: 'De deling van de celkern.',
            sourceId,
            conceptId,
          },
        ],
      });
    expect(cards.status).toBe(201);

    const questions = await request(app)
      .post(`/api/study-packs/${pack.id}/content`)
      .set(auth(token))
      .send({
        target: 'practice',
        questions: [
          {
            questionType: 'short_answer',
            prompt: 'Leg uit wat mitose is.',
            correctAnswer: 'De deling van de celkern.',
            options: null,
            explanation: 'Mitose splitst de celkern.',
            sourceId,
            conceptId,
          },
        ],
      });
    expect(questions.status).toBe(201);

    const stored = getMemoryState();
    const concept = [...stored.concepts.values()].find((entry) => entry.name === 'Mitose');
    expect(concept).toMatchObject({ sourceId, refLabel: 'page 6' });

    const card = [...stored.cards.values()].find((entry) => entry.question === 'Wat is mitose?');
    expect(card).toMatchObject({ sourceId, conceptId });

    const question = [...stored.practiceQuestions.values()].find(
      (entry) => entry.prompt === 'Leg uit wat mitose is.',
    );
    expect(question).toMatchObject({ sourceId, conceptId });

    // The API exposes the same provenance, so the UI can show it.
    const detail = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(token));
    const dtoConcept = detail.body.data.concepts.find((entry: { name: string }) => entry.name === 'Mitose');
    expect(dtoConcept).toMatchObject({ sourceId, refLabel: 'page 6', sourceTitle: 'Biologie H3 aantekeningen' });
  });

  it('links a card to the concept it teaches when the AI names it', async () => {
    const token = await signup();
    const pack = await createPack(token);

    await request(app)
      .post(`/api/study-packs/${pack.id}/content`)
      .set(auth(token))
      .send({ target: 'concepts', concepts: [{ name: 'Osmose', explanation: 'Water door een membraan.' }] });

    // No explicit conceptId: Lerno matches the card to the concept by content.
    const cards = await request(app)
      .post(`/api/study-packs/${pack.id}/content`)
      .set(auth(token))
      .send({
        target: 'flashcards',
        cards: [{ front: 'Wat is osmose?', back: 'Het verplaatsen van water door een membraan.' }],
      });
    expect(cards.status).toBe(201);

    const concepts = [...getMemoryState().concepts.values()];
    const osmose = concepts.find((entry) => entry.name === 'Osmose');
    const card = [...getMemoryState().cards.values()].find(
      (entry) => entry.question === 'Wat is osmose?',
    );
    expect(card?.conceptId).toBe(osmose?.id);
  });
});

describe('provenance: several sources at once', () => {
  it('keeps the sources apart and drops what it cannot place', async () => {
    const token = await signup();
    const pack = await createPack(token);
    const firstSourceId = pack.sources[0].id as string;

    const second = await request(app)
      .post(`/api/study-packs/${pack.id}/sources`)
      .set(auth(token))
      .send({ type: 'text', title: 'Lesnotities', text: 'Osmose verplaatst water door een membraan.' });
    expect(second.status).toBe(201);
    const secondSourceId = second.body.data.id as string;

    // The model answers about both sources, plus one item it cannot place.
    createCompletion.mockImplementation((params: { messages: { content: string }[] }) => {
      const payload = params.messages.map((message) => message.content).join('\n');
      if (payload.includes('"task":"analysis"')) {
        return Promise.resolve(
          completion(
            JSON.stringify({
              summary: 'Twee bronnen over celdeling en transport door membranen in de cel.',
              keyFacts: ['Mitose deelt de celkern.', 'Osmose verplaatst water.'],
              relationships: [],
              examTopics: ['Mitose'],
              difficulty: 'medium',
              sections: [],
              conflicts: [],
            }),
          ),
        );
      }
      if (payload.includes('"task":"concepts"')) {
        return Promise.resolve(
          completion(
            JSON.stringify({
              concepts: [
                { name: 'Mitose', explanation: 'Deling van de celkern.', ref: '1:x1' },
                { name: 'Osmose', explanation: 'Water door een membraan.', ref: '2:x1' },
                { name: 'Verzonnen begrip', explanation: 'Dit staat in geen enkele bron.', ref: '3:x1' },
              ],
            }),
          ),
        );
      }
      if (payload.includes('"task":"summary"')) {
        return Promise.resolve(
          completion(
            JSON.stringify({
              title: 'Cellen',
              summary: 'Mitose deelt de celkern en osmose verplaatst water door een membraan.',
              keyPoints: ['Mitose deelt de celkern', 'Osmose verplaatst water', 'Water gaat door membranen'],
            }),
          ),
        );
      }
      if (payload.includes('"task":"flashcards"')) {
        return Promise.resolve(
          completion(
            JSON.stringify({
              title: 'Cellen',
              description: 'Kaarten uit beide bronnen.',
              cards: [
                { front: 'Wat is mitose?', back: 'De deling van de celkern.', ref: '1:x1', conceptRef: 1 },
                { front: 'Wat is osmose?', back: 'Water door een membraan.', ref: '2:x1', conceptRef: 2 },
              ],
            }),
          ),
        );
      }
      if (payload.includes('"task":"practice"')) {
        return Promise.resolve(
          completion(
            JSON.stringify({
              questions: [
                {
                  type: 'open',
                  question: 'Wat is mitose?',
                  answer: 'De deling van de celkern.',
                  explanation: 'Mitose deelt de celkern.',
                  ref: '1:x1',
                  conceptRef: 1,
                },
                {
                  type: 'open',
                  question: 'Wat is het verzonnen begrip?',
                  answer: 'Dat staat in geen enkele bron.',
                  explanation: 'Deze vraag hoort bij een verzonnen bron.',
                  ref: '3:x1',
                  conceptRef: 1,
                },
              ],
            }),
          ),
        );
      }
      return Promise.resolve(completion(JSON.stringify({})));
    });

    const bundle = await request(app)
      .post(`/api/study-packs/${pack.id}/generate/bundle`)
      .set(auth(token))
      .send({});

    expect(bundle.status).toBe(200);
    const concepts = bundle.body.data.concepts as {
      name: string;
      sourceId: string;
      refLabel: string | null;
    }[];
    const byName = new Map(concepts.map((concept) => [concept.name, concept]));

    expect(byName.get('Mitose')?.sourceId).toBe(firstSourceId);
    expect(byName.get('Mitose')?.refLabel).toBeNull();
    expect(byName.get('Osmose')?.sourceId).toBe(secondSourceId);
    expect(byName.get('Osmose')?.refLabel).toBeNull();
    // The invented marker matches no source: the item is reported, not shown.
    expect(byName.has('Verzonnen begrip')).toBe(false);
    const questions = bundle.body.data.questions as { prompt: string }[];
    expect(questions.map((question) => question.prompt)).toEqual(['Wat is mitose?']);
    expect(
      (bundle.body.data.rejected as { reason: string }[]).map((item) => item.reason),
    ).toContain('missing_source_reference');
  });
});

describe('provenance: conflicts between sources', () => {
  it('reports both sources instead of merging them', async () => {
    const token = await signup();
    await createPack(token);

    // The AI is ready before the uploads, because the pipeline starts right away.
    createCompletion.mockImplementation((params: { messages: { content: string }[] }) => {
      const payload = params.messages.map((message) => message.content).join('\n');
      if (payload.includes('"task":"analysis"')) {
        // The two files are processed one after the other: a conflict can only be
        // reported once Lerno knows both sources.
        const bothSources = payload.includes('[SOURCE 2]');
        return Promise.resolve(
          completion(
            JSON.stringify({
              summary: 'Twee bronnen over chromosomen in de cel, met verschillende aantallen.',
              keyFacts: ['Een cel heeft chromosomen.', 'De bronnen noemen verschillende aantallen.'],
              relationships: [],
              examTopics: ['Chromosomen'],
              difficulty: 'medium',
              sections: [],
              conflicts: bothSources
                ? [
                    {
                      topic: 'Aantal chromosomen',
                      explanation: 'De bronnen noemen verschillende aantallen.',
                      claims: [
                        {
                          statement: 'De cel heeft 46 chromosomen.',
                          ref: '1:p1',
                          quote: '46 chromosomen',
                        },
                        {
                          statement: 'De cel heeft 23 chromosomen.',
                          ref: '2:p1',
                          quote: '23 chromosomen',
                        },
                      ],
                    },
                  ]
                : [],
            }),
          ),
        );
      }
      if (payload.includes('"task":"concepts"')) {
        return Promise.resolve(
          completion(
            JSON.stringify({
              concepts: [
                { name: 'Chromosomen', explanation: 'Dragers van het DNA in de celkern.', ref: '1:p1' },
                { name: 'Mitose', explanation: 'Deling van de celkern in twee kernen.', ref: '1:p1' },
                { name: 'Osmose', explanation: 'Water dat door een membraan verplaatst.', ref: '1:p1' },
              ],
            }),
          ),
        );
      }
      if (payload.includes('"task":"summary"')) {
        return Promise.resolve(
          completion(
            JSON.stringify({
              title: 'Chromosomen',
              summary: 'De bronnen noemen verschillende aantallen chromosomen in de cel.',
              keyPoints: ['Chromosomen dragen DNA', 'De aantallen verschillen', 'De celkern bevat DNA'],
            }),
          ),
        );
      }
      if (payload.includes('"task":"flashcards"')) {
        return Promise.resolve(
          completion(
            JSON.stringify({
              title: 'Chromosomen',
              description: 'Kaarten over chromosomen.',
              cards: [
                {
                  front: 'Wat is een chromosoom?',
                  back: 'Een drager van het DNA in de celkern.',
                  ref: '1:p1',
                  conceptRef: 1,
                },
              ],
            }),
          ),
        );
      }
      if (payload.includes('"task":"practice"')) {
        return Promise.resolve(
          completion(
            JSON.stringify({
              questions: [
                {
                  type: 'open',
                  question: 'Wat is een chromosoom?',
                  answer: 'Een drager van het DNA in de celkern.',
                  explanation: 'Chromosomen zitten in de celkern.',
                  ref: '1:p1',
                  conceptRef: 1,
                },
              ],
            }),
          ),
        );
      }
      return Promise.resolve(completion(JSON.stringify({})));
    });

    // Two PDFs, so both sources have real page references.
    const pdf = (text: string): Buffer => {
      const stream = `BT /F1 12 Tf 20 740 Td 0 -18 Td (${text}) Tj ET`;
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
      ];
      const offsets: number[] = [];
      let body = '%PDF-1.4\n';
      objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(body));
        body += `${index + 1} 0 obj\n${object}\nendobj\n`;
      });
      const xrefOffset = Buffer.byteLength(body);
      body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
      for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
      body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
      return Buffer.from(body, 'ascii');
    };

    const first = await request(app)
      .post('/api/study-packs/import/upload')
      .set(auth(token))
      .field('kind', 'pdf')
      .field('title', 'Biologie H3')
      .attach('file', pdf('De menselijke cel heeft 46 chromosomen in de kern.'), {
        filename: 'biologie-h3.pdf',
        contentType: 'application/pdf',
      });
    expect(first.status).toBe(201);
    const packId = first.body.data.packId as string;

    const second = await request(app)
      .post(`/api/study-packs/${packId}/sources/upload`)
      .set(auth(token))
      .field('kind', 'pdf')
      .field('title', 'Lesnotities')
      .attach('file', pdf('De cel bevat 23 chromosomen volgens deze aantekeningen.'), {
        filename: 'lesnotities.pdf',
        contentType: 'application/pdf',
      });
    // 202: the file is accepted and the pipeline picks it up.
    expect(second.status).toBe(202);

    // Both files go through the real pipeline first: reading, analysis, concepts.
    const processed = await waitForProcessing(token, packId);
    expect(
      processed.sources.map(
        (source: { status: string; stage: string | null; failureReason: string | null }) =>
          `${source.status}@${source.stage}: ${source.failureReason ?? 'ok'}`,
      ),
    ).toEqual(['ready@review: ok', 'ready@review: ok']);

    const bundle = await request(app)
      .post(`/api/study-packs/${packId}/generate/bundle`)
      .set(auth(token))
      .send({});

    expect(bundle.status).toBe(200);
    const conflicts = bundle.body.data.conflicts as {
      topic: string;
      claims: { sourceId: string; referenceLabel: string; statement: string; quote: string }[];
    }[];
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.topic).toBe('Aantal chromosomen');
    expect(conflicts[0]?.claims).toHaveLength(2);
    expect(conflicts[0]?.claims.map((claim) => claim.referenceLabel)).toEqual(['page 1', 'page 1']);
    expect(conflicts[0]?.claims.map((claim) => claim.sourceId)[0]).not.toBe(
      conflicts[0]?.claims.map((claim) => claim.sourceId)[1],
    );
    expect(conflicts[0]?.claims.map((claim) => claim.statement)).toEqual([
      'De cel heeft 46 chromosomen.',
      'De cel heeft 23 chromosomen.',
    ]);
  });
});
