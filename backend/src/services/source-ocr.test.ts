/**
 * Image OCR: the vision model of the existing Groq layer, and the honesty rules
 * around it. The provider is mocked, so these tests are about Lerno's behaviour:
 * what it accepts, what it cleans, and when it refuses to pretend OCR worked.
 */
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/errors.js';
import { config } from '../config.js';
import { handleSourceUpload } from '../middleware/source-upload.js';
import { OCR_MESSAGE_NO_TEXT, cleanOcrText, ocrImage } from './source-ocr.js';

const { createCompletion } = vi.hoisted(() => ({ createCompletion: vi.fn() }));

vi.mock('groq-sdk', () => {
  class Groq {
    chat = { completions: { create: createCompletion } };
    constructor(_options: unknown) {}
  }
  return { default: Groq };
});

const mutableConfig = config as unknown as { groqApiKey: string };

/** A 1x1 PNG — the signature is what the upload layer checks. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function reply(content: string): unknown {
  return { choices: [{ index: 0, message: { role: 'assistant', content } }] };
}

describe('ocr: reading a real image', () => {
  beforeEach(() => {
    createCompletion.mockReset();
    mutableConfig.groqApiKey = 'test-key';
  });

  afterEach(() => {
    mutableConfig.groqApiKey = '';
  });

  it('returns the transcribed text and the engine that read it', async () => {
    createCompletion.mockResolvedValue(
      reply('Celkern: bevat het DNA.\nMitose: deling van de celkern.'),
    );

    const result = await ocrImage({ buffer: PNG, mimeType: 'image/png' });

    expect(result.text).toContain('Mitose: deling van de celkern.');
    expect(result.engine).toBe(`groq:${config.groqVisionModel}`);
    expect(result.characters).toBe(result.text.length);
  });

  it('sends the image to the vision model as a data URL, never to disk', async () => {
    createCompletion.mockResolvedValue(reply('Osmose is verplaatsing van water.'));

    await ocrImage({ buffer: PNG, mimeType: 'image/jpeg' });

    const [params] = createCompletion.mock.calls[0] as [Record<string, unknown>];
    expect(params.model).toBe(config.groqVisionModel);
    const messages = params.messages as { content: { type: string; image_url?: { url: string } }[] }[];
    const imagePart = messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .find((part) => part.type === 'image_url');
    expect(imagePart?.image_url?.url).toBe(`data:image/jpeg;base64,${PNG.toString('base64')}`);
  });

  it('cleans up the whitespace and markdown fences a model adds', () => {
    expect(cleanOcrText('```\n  Celkern   bevat het DNA.\n\n  Mitose   deelt de celkern.  \n```')).toBe(
      'Celkern bevat het DNA.\n\nMitose deelt de celkern.',
    );
  });

  it('treats NO_TEXT as no text at all', async () => {
    createCompletion.mockResolvedValue(reply('NO_TEXT'));

    await expect(ocrImage({ buffer: PNG, mimeType: 'image/png' })).rejects.toThrow(
      OCR_MESSAGE_NO_TEXT,
    );
  });

  it("rejects model chatter instead of storing it as material", async () => {
    createCompletion.mockResolvedValue(
      reply("I can't read any text in this image. It looks like a photo of a table."),
    );

    const error = await ocrImage({ buffer: PNG, mimeType: 'image/png' }).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(OCR_MESSAGE_NO_TEXT);
    // The exact student-facing sentence, verbatim.
    expect((error as ApiError).message).toContain("We couldn't detect enough text in this image.");
  });

  it('rejects an empty provider answer', async () => {
    createCompletion.mockResolvedValue(reply('   \n  '));

    await expect(ocrImage({ buffer: PNG, mimeType: 'image/png' })).rejects.toThrow(
      "We couldn't detect enough text in this image.",
    );
  });

  it('refuses an unsupported image type before calling the model', async () => {
    await expect(ocrImage({ buffer: PNG, mimeType: 'image/gif' })).rejects.toThrow(
      'Choose a PNG, JPG or WEBP image.',
    );
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('never claims success when the provider fails', async () => {
    createCompletion.mockRejectedValue(Object.assign(new Error('upstream exploded'), { status: 500 }));

    const error = await ocrImage({ buffer: PNG, mimeType: 'image/png' }).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('AI_ERROR');
    expect((error as ApiError).message).not.toContain('upstream exploded');
  });

  it('fails honestly when OCR is not configured at all', async () => {
    mutableConfig.groqApiKey = '';

    await expect(ocrImage({ buffer: PNG, mimeType: 'image/png' })).rejects.toThrow(
      "We couldn't read this image right now. Try again later or paste the text instead.",
    );
    expect(createCompletion).not.toHaveBeenCalled();
  });
});

describe('image upload guard', () => {
  const app = express();
  app.post('/upload', handleSourceUpload(), (_req, res) => res.json({ ok: true }));
  app.use((error: ApiError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ code: error.code, message: error.message });
  });

  it('rejects an image above the size limit with the real limit in the message', async () => {
    const tooBig = Buffer.alloc(config.sourceMaxImageBytes + 1_024, 0x89);

    const response = await request(app)
      .post('/upload')
      .field('kind', 'image')
      .attach('file', tooBig, { filename: 'notities.png', contentType: 'image/png' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/This file is too large\. The limit for image files is \d+ MB\./);
  });

  it('accepts an image within the limit', async () => {
    const response = await request(app)
      .post('/upload')
      .field('kind', 'image')
      .attach('file', PNG, { filename: 'notities.png', contentType: 'image/png' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('rejects a PDF that claims to be an image', async () => {
    const response = await request(app)
      .post('/upload')
      .field('kind', 'image')
      .attach('file', PNG, { filename: 'notities.pdf', contentType: 'image/png' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('That file type does not match an image source.');
  });
});
