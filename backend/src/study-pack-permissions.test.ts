/**
 * Ownership: every source, every generated item and every write belongs to the
 * student who owns the pack. Another student gets the same answer as for a pack
 * that does not exist, and a guest gets nothing at all.
 *
 * These tests walk the whole content engine surface — reading material, adding
 * sources (text, file, YouTube), processing, generating, regenerating and
 * applying content — because a missing check in any one of them is a data leak.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';
import { importJobs } from './lib/import-job-store.js';

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
  const email = `perm${counter}-${Math.floor(Math.random() * 1e7)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: 'Permission Student' });
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

/** A 1x1 PNG: valid signature, small enough for every limit. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function createPack(token: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/study-packs')
    .set(auth(token))
    .send({
      title: 'Biologie H3',
      level: '3 MAVO',
      visibility: 'private',
      source: { type: 'text', title: 'Biologie H3 aantekeningen', text: MATERIAL },
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeEach(() => {
  mutableConfig.groqApiKey = 'test-groq-key';
  importJobs.clear();
  createCompletion.mockReset();
  createCompletion.mockResolvedValue({ choices: [{ message: { role: 'assistant', content: '{}' } }] });
});

describe('study pack permissions: the owner', () => {
  it('can read, extend and process their own pack', async () => {
    const token = await signup();
    const pack = await createPack(token);

    expect((await request(app).get(`/api/study-packs/${pack.id}`).set(auth(token))).status).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/study-packs/${pack.id}/sources`)
          .set(auth(token))
          .send({ type: 'text', title: 'Extra notities', text: MATERIAL })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app)
          .post(`/api/study-packs/${pack.id}/content`)
          .set(auth(token))
          .send({ target: 'concepts', concepts: [{ name: 'Fotosynthese', explanation: 'Planten maken glucose.' }] })
      ).status,
    ).toBe(201);
  });
});

describe('study pack permissions: another student', () => {
  it('cannot read someone else’s pack, sources or processing state', async () => {
    const owner = await signup();
    const stranger = await signup();
    const pack = await createPack(owner);
    const sourceId = pack.sources[0].id as string;

    expect((await request(app).get(`/api/study-packs/${pack.id}`).set(auth(stranger))).status).toBe(404);
    expect(
      (await request(app).get(`/api/study-packs/${pack.id}/processing`).set(auth(stranger))).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/study-packs/${pack.id}/practice`).set(auth(stranger))).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/study-packs/${pack.id}/concepts`).set(auth(stranger))).status,
    ).toBe(404);
    expect(sourceId).toBeTruthy();
  });

  it('cannot add sources — text, file or YouTube — to someone else’s pack', async () => {
    const owner = await signup();
    const stranger = await signup();
    const pack = await createPack(owner);

    expect(
      (
        await request(app)
          .post(`/api/study-packs/${pack.id}/sources`)
          .set(auth(stranger))
          .send({ type: 'text', title: 'Injectie', text: MATERIAL })
      ).status,
    ).toBe(404);

    const upload = await request(app)
      .post(`/api/study-packs/${pack.id}/sources/upload`)
      .set(auth(stranger))
      .field('kind', 'image')
      .attach('file', PNG, { filename: 'foto.png', contentType: 'image/png' });
    expect(upload.status).toBe(404);

    expect(
      (
        await request(app)
          .post(`/api/study-packs/${pack.id}/sources/youtube`)
          .set(auth(stranger))
          .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', transcript: MATERIAL })
      ).status,
    ).toBe(404);
  });

  it('cannot process, generate or regenerate content in someone else’s pack', async () => {
    const owner = await signup();
    const stranger = await signup();
    const pack = await createPack(owner);
    const sourceId = pack.sources[0].id as string;

    expect(
      (
        await request(app)
          .post(`/api/study-packs/${pack.id}/process`)
          .set(auth(stranger))
          .send({ sourceId })
      ).status,
    ).toBe(404);

    expect(
      (
        await request(app)
          .post(`/api/study-packs/${pack.id}/generate/bundle`)
          .set(auth(stranger))
          .send({})
      ).status,
    ).toBe(404);

    expect(
      (
        await request(app)
          .post(`/api/study-packs/${pack.id}/generate/regenerate`)
          .set(auth(stranger))
          .send({ kind: 'flashcard', current: { front: 'Wat is mitose?' } })
      ).status,
    ).toBe(404);

    // Nothing was started for the stranger, and the owner's pack is untouched.
    const status = await request(app)
      .get(`/api/study-packs/${pack.id}/processing`)
      .set(auth(owner));
    expect(status.body.data.processing).toBe(false);
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('cannot apply content to someone else’s pack', async () => {
    const owner = await signup();
    const stranger = await signup();
    const pack = await createPack(owner);

    const before = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(owner));
    expect(before.body.data.counts.concepts).toBe(0);

    expect(
      (
        await request(app)
          .post(`/api/study-packs/${pack.id}/content`)
          .set(auth(stranger))
          .send({
            target: 'concepts',
            concepts: [{ name: 'Ingeslopen begrip', explanation: 'Deze mag er niet komen te staan.' }],
          })
      ).status,
    ).toBe(404);

    const after = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(owner));
    expect(after.body.data.counts.concepts).toBe(0);
  });

  it('cannot remove someone else’s source or pack', async () => {
    const owner = await signup();
    const stranger = await signup();
    const pack = await createPack(owner);
    const sourceId = pack.sources[0].id as string;

    expect(
      (await request(app).delete(`/api/study-packs/${pack.id}/sources/${sourceId}`).set(auth(stranger))).status,
    ).toBe(404);
    expect((await request(app).delete(`/api/study-packs/${pack.id}`).set(auth(stranger))).status).toBe(404);

    const detail = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(owner));
    expect(detail.body.data.sources).toHaveLength(1);
  });

  it('keeps writing endpoints closed even when a pack is readable by everyone', async () => {
    const owner = await signup();
    const stranger = await signup();
    const pack = await createPack(owner, { visibility: 'public' });

    // Reading a shared pack is the point of a public pack…
    expect((await request(app).get(`/api/study-packs/${pack.id}`).set(auth(stranger))).status).toBe(200);
    // …but everything that changes it stays with the owner.
    expect(
      (
        await request(app)
          .post(`/api/study-packs/${pack.id}/content`)
          .set(auth(stranger))
          .send({ target: 'concepts', concepts: [{ name: 'Van een ander', explanation: 'Niet toegestaan.' }] })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/study-packs/${pack.id}/process`)
          .set(auth(stranger))
          .send({})
      ).status,
    ).toBe(404);
  });
});

describe('study pack permissions: guests', () => {
  it('cannot read or write anything without a token', async () => {
    const owner = await signup();
    const pack = await createPack(owner);
    const sourceId = pack.sources[0].id as string;

    expect((await request(app).get(`/api/study-packs/${pack.id}`)).status).toBe(404);
    expect((await request(app).post(`/api/study-packs/${pack.id}/process`).send({})).status).toBe(401);
    expect((await request(app).post(`/api/study-packs/${pack.id}/generate/bundle`).send({})).status).toBe(401);
    expect(
      (
        await request(app)
          .post(`/api/study-packs/${pack.id}/content`)
          .send({ target: 'concepts', concepts: [{ name: 'Gast', explanation: 'Geen toegang.' }] })
      ).status,
    ).toBe(401);
    expect(
      (await request(app).delete(`/api/study-packs/${pack.id}/sources/${sourceId}`)).status,
    ).toBe(401);
    expect((await request(app).delete(`/api/study-packs/${pack.id}`)).status).toBe(401);
  });
});
