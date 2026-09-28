import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';
import {
  generatedCardsSchema,
  generatedQuizSchema,
  generatedStudyPlanSchema,
  generatedSummarySchema,
} from './lib/ai-schemas.js';
import { buildSetSourceContext, buildTextContext } from './lib/ai-studio-context.js';
import { studioSourceSchema } from './validators/ai-studio.validators.js';

const { createCompletion } = vi.hoisted(() => ({ createCompletion: vi.fn() }));

vi.mock('groq-sdk', () => {
  class Groq {
    chat = { completions: { create: createCompletion } };
    constructor(_options: unknown) {}
  }
  return { default: Groq };
});

const app = createApp();
const mutableConfig = config as unknown as { groqApiKey: string };
let signupCount = 0;

async function signup(): Promise<{ token: string; id: string }> {
  signupCount += 1;
  const response = await request(app)
    .post('/api/auth/signup')
    .send({
      email: `studio-${signupCount}-${Math.floor(Math.random() * 1e7)}@example.com`,
      password: 'password123',
      displayName: 'Studio Student',
    });
  return {
    token: response.body.data.accessToken as string,
    id: response.body.data.user.id as string,
  };
}

async function createSet(token: string, visibility: 'private' | 'public' = 'private') {
  const response = await request(app)
    .post('/api/sets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Cell biology source',
      visibility,
      cards: [
        { question: 'What is a cell?', answer: 'The basic unit of life.' },
        { question: 'What is a nucleus?', answer: 'It contains genetic material.' },
      ],
    });
  return response.body.data.id as string;
}

const notesSource = {
  type: 'text' as const,
  title: 'Biology notes',
  text: 'Photosynthesis uses light energy to make glucose in plants. Chlorophyll absorbs light.',
};

function completion(content: string): unknown {
  return {
    choices: [{ index: 0, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 300, completion_tokens: 100, total_tokens: 400 },
  };
}

function makePdf(text?: string): Buffer {
  const stream = text
    ? `BT /F1 12 Tf 20 100 Td (${text.replace(/[\\()]/g, '\\$&')}) Tj ET`
    : 'q Q';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AI Study Studio authorization and source handling', () => {
  it('requires authentication for PDF extraction and AI actions', async () => {
    const pdf = await request(app)
      .post('/api/ai/studio/sources/pdf')
      .attach('file', makePdf('This is a real PDF with enough selectable text.'), 'notes.pdf');
    expect(pdf.status).toBe(401);
    expect(pdf.body.error.code).toBe('UNAUTHORIZED');

    const action = await request(app).post('/api/ai/studio/summary').send({ source: notesSource });
    expect(action.status).toBe(401);
    expect(action.body.error.code).toBe('UNAUTHORIZED');
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('re-authorizes set IDs and returns no data for another user’s private set', async () => {
    const owner = await signup();
    const other = await signup();
    const setId = await createSet(owner.token, 'private');
    createCompletion.mockResolvedValue(completion('This must not be returned.'));

    const response = await request(app)
      .post('/api/ai/studio/summary')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ source: { type: 'set', setId } });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(response.body)).not.toContain('Cell biology source');
    expect(createCompletion).not.toHaveBeenCalled();

    const malformed = await request(app)
      .post('/api/ai/studio/summary')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ source: { type: 'set', setId: 'not-a-uuid' } });
    expect(malformed.status).toBe(400);
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('uses bounded context from a set the caller may view', async () => {
    const student = await signup();
    const setId = await createSet(student.token);
    createCompletion.mockResolvedValue(completion(JSON.stringify({
      title: 'Cells',
      summary: 'Cells are the smallest living structures and contain important material.',
      keyPoints: ['Cells form living things.', 'The nucleus contains genetic material.', 'Cells have specialized parts.'],
      terms: [],
    })));
    const response = await request(app)
      .post('/api/ai/studio/summary')
      .set('Authorization', `Bearer ${student.token}`)
      .send({ source: { type: 'set', setId } });
    expect(response.status).toBe(200);
    expect(response.body.data.title).toBe('Cells');
    const messages = createCompletion.mock.calls[0]![0].messages as { role: string; content: string }[];
    expect(messages[0]!.content).toContain('supplied Lerno set');
    const payload = JSON.parse(messages.at(-1)!.content) as { source: string };
    expect(payload.source).toContain('Cell biology source');
    expect(payload.source).toContain('What is a cell?');
  });

  it('does not accept file IDs or source-cache IDs as authority', async () => {
    const student = await signup();
    const response = await request(app)
      .post('/api/ai/studio/sources/00000000-0000-4000-8000-000000000123/summary')
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect(response.status).toBe(404);
    expect(createCompletion).not.toHaveBeenCalled();
  });
});

describe('AI Study Studio generation', () => {
  it('validates structured summary output, retries invalid content, and uses only supplied context', async () => {
    const student = await signup();
    const invalid = {
      title: 'Biology', summary: 'Too short.',
      keyPoints: ['Cells matter.', 'Cells matter.', 'Plants need light.'], terms: [],
    };
    const valid = {
      title: 'Photosynthesis',
      summary: 'Plants use energy from light to make glucose. Chlorophyll absorbs light in the leaves.',
      keyPoints: ['Light provides energy for the process.', 'Plants make glucose.', 'Chlorophyll absorbs light.'],
      terms: [{ term: 'Chlorophyll', definition: 'The pigment that absorbs light energy in plants.' }],
    };
    createCompletion.mockResolvedValueOnce(completion(JSON.stringify(invalid))).mockResolvedValueOnce(completion(JSON.stringify(valid)));

    const response = await request(app)
      .post('/api/ai/studio/summary')
      .set('Authorization', `Bearer ${student.token}`)
      .send({ source: notesSource });
    expect(response.status).toBe(200);
    expect(response.body.data.keyPoints).toHaveLength(3);
    expect(createCompletion).toHaveBeenCalledTimes(2);
    const messages = createCompletion.mock.calls[1]![0].messages as { role: string; content: string }[];
    const userPayload = JSON.parse(messages.at(-1)!.content) as { source: string };
    expect(userPayload.source).toContain('Photosynthesis uses light energy');
    expect(userPayload.source).toContain('SOURCE TYPE: pasted text');
  });

  it('uses the requested card count and never auto-saves generated flashcards', async () => {
    const student = await signup();
    const result = {
      title: 'Light and plants', description: 'Important ideas about photosynthesis.',
      cards: [
        { front: 'What does chlorophyll absorb?', back: 'Light energy.' },
        { front: 'What do plants make?', back: 'Glucose.' },
        { front: 'What provides energy?', back: 'Light.' },
      ],
    };
    createCompletion.mockResolvedValue(completion(JSON.stringify(result)));
    const response = await request(app)
      .post('/api/ai/studio/cards')
      .set('Authorization', `Bearer ${student.token}`)
      .send({ source: notesSource, count: 3 });
    expect(response.status).toBe(200);
    expect(response.body.data.cards).toHaveLength(3);
    expect(response.body.data).not.toHaveProperty('savedSetId');
    expect(createCompletion.mock.calls[0]![0].messages.at(-1)!.content).toContain('"count":3');
  });

  it('validates quiz question count, allowed types and duplicate choices', async () => {
    const student = await signup();
    const invalid = {
      questions: Array.from({ length: 3 }, (_, index) => ({
        type: 'multiple_choice', question: `Question ${index + 1}?`,
        options: ['Light', 'light', 'Water', 'Soil'], correctIndex: 0,
        answer: 'Light', explanation: 'Light is used.',
      })),
    };
    const valid = {
      questions: Array.from({ length: 3 }, (_, index) => ({
        type: 'multiple_choice', question: `Question ${index + 1}?`,
        options: ['Light', 'Water', 'Soil', 'Salt'], correctIndex: 0,
        answer: 'Light', explanation: 'Light is used.',
      })),
    };
    createCompletion.mockResolvedValueOnce(completion(JSON.stringify(invalid))).mockResolvedValueOnce(completion(JSON.stringify(valid)));
    const response = await request(app)
      .post('/api/ai/studio/quiz')
      .set('Authorization', `Bearer ${student.token}`)
      .send({ source: notesSource, count: 3, types: ['multiple_choice'] });
    expect(response.status).toBe(200);
    expect(response.body.data.questions).toHaveLength(3);
    expect(response.body.data.questions.every((question: { type: string }) => question.type === 'multiple_choice')).toBe(true);
    expect(createCompletion).toHaveBeenCalledTimes(2);
  });

  it('generates requested practice question count from source, not invented chapter context', async () => {
    const student = await signup();
    const generated = {
      questions: [
        { type: 'open', question: 'What provides energy for photosynthesis?', answer: 'Light energy.', hint: 'Think about the energy source.' },
        { type: 'open', question: 'What do plants produce?', answer: 'Glucose.', hint: 'It is a type of sugar.' },
        { type: 'open', question: 'What absorbs light in plants?', answer: 'Chlorophyll.', hint: 'It is a green pigment.' },
      ],
    };
    createCompletion.mockResolvedValue(completion(JSON.stringify(generated)));
    const response = await request(app)
      .post('/api/ai/studio/questions')
      .set('Authorization', `Bearer ${student.token}`)
      .send({ source: notesSource, count: 3, difficulty: 'normal' });
    expect(response.status).toBe(200);
    expect(response.body.data.questions).toHaveLength(3);
    const userPayload = createCompletion.mock.calls[0]![0].messages.at(-1)!.content as string;
    expect(userPayload).toContain('Photosynthesis uses light energy');
    expect(userPayload).not.toContain('chapter 1');
  });

  it('builds a source-grounded plan with the requested days and daily time', async () => {
    const student = await signup();
    const result = {
      title: 'Photosynthesis in three days',
      overview: 'A short plan to review the main ideas in the supplied notes over three sessions.',
      sessions: [1, 2, 3].map((day) => ({
        day,
        focus: ['Light energy', 'Chlorophyll', 'Review the full process'][day - 1]!,
        activities: [`Review one idea from the notes for day ${day}.`],
        minutes: 15,
      })),
    };
    createCompletion.mockResolvedValue(completion(JSON.stringify(result)));
    const response = await request(app)
      .post('/api/ai/studio/plan')
      .set('Authorization', `Bearer ${student.token}`)
      .send({ source: notesSource, days: 3, minutesPerDay: 15 });
    expect(response.status).toBe(200);
    expect(response.body.data.sessions).toHaveLength(3);
    expect(response.body.data.sessions.every((session: { minutes: number }) => session.minutes === 15)).toBe(true);
    expect(createCompletion.mock.calls[0]![0].messages.at(-1)!.content).toContain('"days":3');
  });

  it('answers chat from the selected source and keeps bounded source-aware history', async () => {
    const student = await signup();
    createCompletion.mockResolvedValue(completion('Your notes say plants make glucose.'));
    const response = await request(app)
      .post('/api/ai/studio/chat')
      .set('Authorization', `Bearer ${student.token}`)
      .send({
        source: notesSource,
        message: 'What do plants make?',
        history: [{ role: 'user', content: 'What is photosynthesis?' }, { role: 'assistant', content: 'A process in plants.' }],
      });
    expect(response.status).toBe(200);
    expect(response.body.data.reply).toContain('glucose');
    const messages = createCompletion.mock.calls[0]![0].messages as { role: string; content: string }[];
    expect(messages[0]!.content).toContain('Context source: student-pasted study material.');
    const payload = JSON.parse(messages.at(-1)!.content) as { source: string; latestQuestion: string; recentConversation: unknown[] };
    expect(payload.source).toContain('Biology notes');
    expect(payload.latestQuestion).toBe('What do plants make?');
    expect(payload.recentConversation).toHaveLength(2);
  });

  it('rejects too many source characters before Groq', async () => {
    const student = await signup();
    const response = await request(app)
      .post('/api/ai/studio/summary')
      .set('Authorization', `Bearer ${student.token}`)
      .send({ source: { ...notesSource, text: 'x'.repeat(50_001) } });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(createCompletion).not.toHaveBeenCalled();
  });
});

describe('AI Study Studio PDF handling', () => {
  it('accepts real PDFs and returns extracted text only to the uploader for this session', async () => {
    const student = await signup();
    const response = await request(app)
      .post('/api/ai/studio/sources/pdf')
      .set('Authorization', `Bearer ${student.token}`)
      .attach('file', makePdf('Photosynthesis uses light energy to make glucose in plants.'), {
        filename: 'biology.pdf', contentType: 'application/pdf',
      });
    expect(response.status).toBe(201);
    expect(response.body.data.title).toBe('biology');
    expect(response.body.data.pageCount).toBe(1);
    expect(response.body.data.text).toContain('Photosynthesis');
    expect(response.body.data).not.toHaveProperty('publicUrl');
    expect(response.body.data).not.toHaveProperty('fileId');
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('rejects fake PDFs and clearly refuses scanned/image-only PDFs without OCR', async () => {
    const student = await signup();
    const fake = await request(app)
      .post('/api/ai/studio/sources/pdf')
      .set('Authorization', `Bearer ${student.token}`)
      .attach('file', Buffer.from('not really a PDF'), { filename: 'fake.pdf', contentType: 'application/pdf' });
    expect(fake.status).toBe(400);
    expect(fake.body.error.code).toBe('VALIDATION_ERROR');
    expect(fake.body.error.message).toMatch(/not a valid PDF/i);

    const imageOnly = await request(app)
      .post('/api/ai/studio/sources/pdf')
      .set('Authorization', `Bearer ${student.token}`)
      .attach('file', makePdf(), { filename: 'scan.pdf', contentType: 'application/pdf' });
    expect(imageOnly.status).toBe(400);
    expect(imageOnly.body.error.message).toMatch(/image-only|scanned/i);
    expect(createCompletion).not.toHaveBeenCalled();
  });
});

describe('AI Study Studio context and quality schemas', () => {
  it('removes duplicate lines, labels PDF provenance, and caps text context with omission marker', () => {
    const context = buildTextContext({
      title: 'Class notes', kind: 'pdf', pageCount: 12,
      text: `Repeated line\nRepeated line\n${'unique words '.repeat(150)}`,
      extractedChars: 2_000, truncated: true,
    }, 700);
    expect(context.length).toBeLessThanOrEqual(700);
    expect(context).toContain('SOURCE TYPE: PDF document');
    expect(context).toContain('PDF PAGES: 12');
    expect(context).toContain('Middle of source omitted');
    expect(context.match(/Repeated line/g)).toHaveLength(1);
    expect(context).toContain('not all source text is included');
  });

  it('applies a smaller per-task cap to authorized set material', () => {
    const context = buildSetSourceContext('My biology set', 'CARD\n' + 'photosynthesis '.repeat(400), 1_000);
    expect(context.length).toBeLessThanOrEqual(1_000);
    expect(context).toContain('SOURCE TYPE: Lerno study set');
    expect(context).toContain('My biology set');
    expect(context).toContain('Set context shortened');
  });

  it('rejects duplicate quiz options, duplicate flashcard fronts and missing summary structure', () => {
    const duplicateOptions = generatedQuizSchema.safeParse({
      questions: [{
        type: 'multiple_choice', question: 'Which is the source of energy?',
        options: ['Light', 'light', 'Water', 'Soil'], correctIndex: 0,
        answer: 'Light', explanation: 'Light energy is used.',
      }],
    });
    expect(duplicateOptions.success).toBe(false);

    const duplicateFronts = generatedCardsSchema.safeParse({
      title: 'Plants', cards: [
        { front: 'What is chlorophyll?', back: 'A green pigment.' },
        { front: '  WHAT IS CHLOROPHYLL? ', back: 'A different answer.' },
      ],
    });
    expect(duplicateFronts.success).toBe(false);
    expect(generatedSummarySchema.safeParse({ title: 'No', summary: '', keyPoints: [] }).success).toBe(false);
    expect(generatedStudyPlanSchema.safeParse({
      title: 'Plan', overview: 'A short plan with enough useful study planning details.',
      sessions: [
        { day: 1, focus: 'Review light energy', activities: ['Recall key terms'], minutes: 20 },
        { day: 1, focus: 'Review chlorophyll', activities: ['Read notes'], minutes: 20 },
        { day: 3, focus: 'Review everything', activities: ['Self-test'], minutes: 20 },
      ],
    }).success).toBe(false);
  });

  it('accepts only source text or a set reference, without file IDs', () => {
    expect(studioSourceSchema.safeParse(notesSource).success).toBe(true);
    const forgedFile = studioSourceSchema.safeParse({ ...notesSource, fileId: 'other-user-file' });
    expect(forgedFile.success).toBe(true);
    if (forgedFile.success) expect(forgedFile.data).not.toHaveProperty('fileId');
    expect(studioSourceSchema.safeParse({ type: 'set', setId: 'not-a-uuid' }).success).toBe(false);
  });
});
