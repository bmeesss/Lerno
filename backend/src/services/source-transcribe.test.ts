/**
 * Audio transcription: the audio is never stored, only its text — and only when
 * the transcript is really usable. When it is not, the source fails with a clear
 * message instead of continuing with empty material.
 *
 * The provider (Groq Whisper) is mocked; the timestamps below are the ones that
 * later become provenance like "Generated from 3:42 in recording".
 */
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/errors.js';
import { config } from '../config.js';
import { handleSourceUpload } from '../middleware/source-upload.js';
import {
  TRANSCRIPTION_UNAVAILABLE_MESSAGE,
  normalizeTranscription,
  segmentLabels,
  transcribeAudio,
} from './source-transcribe.js';

const { createTranscription } = vi.hoisted(() => ({ createTranscription: vi.fn() }));

vi.mock('groq-sdk', () => {
  class Groq {
    audio = { transcriptions: { create: createTranscription } };
    constructor(_options: unknown) {}
  }
  return { default: Groq };
});

const mutableConfig = config as unknown as { groqApiKey: string };

const MP3 = Buffer.concat([Buffer.from('ID3\u0003\u0000', 'ascii'), Buffer.alloc(512, 0x11)]);

function verboseJson(overrides: Record<string, unknown> = {}): unknown {
  return {
    text: 'De celkern bevat het DNA en regelt de celdeling.',
    language: 'nl',
    duration: 412.5,
    segments: [
      { start: 0, end: 4.2, text: ' De celkern bevat het DNA ' },
      { start: 222, end: 226.4, text: 'en regelt de celdeling.' },
    ],
    ...overrides,
  };
}

describe('transcription: a real recording', () => {
  beforeEach(() => {
    createTranscription.mockReset();
    mutableConfig.groqApiKey = 'test-key';
  });

  afterEach(() => {
    mutableConfig.groqApiKey = '';
  });

  it('joins the spoken segments into the transcript of the source', async () => {
    createTranscription.mockResolvedValue(verboseJson());

    const result = await transcribeAudio({
      buffer: MP3,
      filename: 'les-3.mp3',
      mimeType: 'audio/mpeg',
    });

    expect(result.text).toBe('De celkern bevat het DNA en regelt de celdeling.');
    expect(result.language).toBe('nl');
    expect(result.durationSeconds).toBe(412.5);
    expect(result.model).toBe(config.groqTranscribeModel);
  });

  it('keeps every segment with its own offset', async () => {
    createTranscription.mockResolvedValue(verboseJson());

    const result = await transcribeAudio({
      buffer: MP3,
      filename: 'les-3.mp3',
      mimeType: 'audio/mpeg',
    });

    expect(result.segments).toEqual([
      { startSeconds: 0, endSeconds: 4.2, text: 'De celkern bevat het DNA' },
      { startSeconds: 222, endSeconds: 226.4, text: 'en regelt de celdeling.' },
    ]);
  });

  it('labels segments so a card can honestly say where it came from', () => {
    const labels = segmentLabels([
      { startSeconds: 0, endSeconds: 4.2, text: 'eerste' },
      { startSeconds: 222, endSeconds: 226.4, text: 'tweede' },
      { startSeconds: 3_731, endSeconds: 3_735, text: 'derde' },
    ]);

    expect(labels).toEqual([
      { marker: 't0', label: '0:00 in recording' },
      { marker: 't222', label: '3:42 in recording' },
      { marker: 't3731', label: '1:02:11 in recording' },
    ]);
  });

  it('falls back to the plain text when the provider sends no segments', () => {
    const result = normalizeTranscription({ text: 'Alleen platte tekst.' });

    expect(result.text).toBe('Alleen platte tekst.');
    expect(result.segments).toEqual([]);
    expect(result.durationSeconds).toBeNull();
    expect(result.language).toBeNull();
  });

  it('ignores unusable segments instead of inventing timestamps', () => {
    const result = normalizeTranscription({
      text: 'Vangnet.',
      segments: [
        { text: 'geen starttijd' },
        { start: 'nope', text: 'ook niets' },
        { start: 12, text: '  ' },
        { start: 30, end: 35, text: 'Deze wel.' },
      ],
    });

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toEqual({ startSeconds: 30, endSeconds: 35, text: 'Deze wel.' });
    // Without a reported duration the last real segment end is the best bound.
    expect(result.durationSeconds).toBe(35);
  });
});

describe('transcription: honest failures', () => {
  beforeEach(() => {
    createTranscription.mockReset();
    mutableConfig.groqApiKey = 'test-key';
  });

  afterEach(() => {
    mutableConfig.groqApiKey = '';
  });

  it('refuses a recording without enough speech', async () => {
    createTranscription.mockResolvedValue(verboseJson({ text: 'Hm.', segments: [] }));

    await expect(
      transcribeAudio({ buffer: MP3, filename: 'stil.mp3', mimeType: 'audio/mpeg' }),
    ).rejects.toThrow("We couldn't hear enough speech in this recording.");
  });

  it('refuses an empty transcript', async () => {
    createTranscription.mockResolvedValue(verboseJson({ text: '   ', segments: [] }));

    await expect(
      transcribeAudio({ buffer: MP3, filename: 'stil.mp3', mimeType: 'audio/mpeg' }),
    ).rejects.toThrow(
      "We couldn't hear enough speech in this recording. Check that the audio has clear speech.",
    );
  });

  it('never leaks an upstream failure to the student', async () => {
    createTranscription.mockRejectedValue(
      Object.assign(new Error('whisper exploded with api key gsk_secret'), { status: 500 }),
    );

    const error = await transcribeAudio({
      buffer: MP3,
      filename: 'les.mp3',
      mimeType: 'audio/mpeg',
    }).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(TRANSCRIPTION_UNAVAILABLE_MESSAGE);
    expect((error as ApiError).message).not.toContain('gsk_secret');
    expect((error as ApiError).message).toContain("We couldn't transcribe this recording.");
  });

  it('passes a rate limit through as a rate limit, not as a broken recording', async () => {
    createTranscription.mockRejectedValue(Object.assign(new Error('slow down'), { status: 429 }));

    const error = await transcribeAudio({
      buffer: MP3,
      filename: 'les.mp3',
      mimeType: 'audio/mpeg',
    }).catch((thrown) => thrown);

    expect((error as ApiError).code).toBe('RATE_LIMITED');
  });

  it('fails honestly when transcription is not configured', async () => {
    mutableConfig.groqApiKey = '';

    await expect(
      transcribeAudio({ buffer: MP3, filename: 'les.mp3', mimeType: 'audio/mpeg' }),
    ).rejects.toThrow(
      'Transcription is not available right now. The audio is saved — try again later or paste the text instead.',
    );
    expect(createTranscription).not.toHaveBeenCalled();
  });
});

describe('audio upload guard', () => {
  const app = express();
  app.post('/upload', handleSourceUpload(), (_req, res) => res.json({ ok: true }));
  app.use((error: ApiError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ code: error.code, message: error.message });
  });

  it('accepts the audio containers Lerno really supports', async () => {
    for (const [filename, contentType] of [
      ['les.mp3', 'audio/mpeg'],
      ['les.wav', 'audio/wav'],
      ['les.m4a', 'audio/mp4'],
      ['les.webm', 'audio/webm'],
    ] as const) {
      const response = await request(app)
        .post('/upload')
        .field('kind', 'audio')
        .attach('file', MP3, { filename, contentType });
      expect(response.status).toBe(200);
    }
  });

  it('rejects an unsupported recording type', async () => {
    const response = await request(app)
      .post('/upload')
      .field('kind', 'audio')
      .attach('file', MP3, { filename: 'les.flac', contentType: 'audio/flac' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('That file type is not supported for audio sources.');
  });

  it('rejects a recording above the size limit', async () => {
    const tooBig = Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.alloc(config.sourceMaxAudioBytes, 0x11)]);

    const response = await request(app)
      .post('/upload')
      .field('kind', 'audio')
      .attach('file', tooBig, { filename: 'les.mp3', contentType: 'audio/mpeg' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/This file is too large\. The limit for audio files is \d+ MB\./);
  });
});
