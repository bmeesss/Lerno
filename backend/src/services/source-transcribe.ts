/**
 * Audio → text (transcription).
 *
 * Uses the transcription model of the existing Groq layer (same server-side key
 * as every other AI feature). The audio itself is never stored by Lerno — only
 * the transcript becomes part of the source, with the timestamps of every
 * segment, so a later generated card can honestly say
 * "Generated from 03:42 in recording".
 *
 * Failure is never silent: without a transcript the source fails with a clear
 * message and the student can retry, exactly like a PDF that cannot be read.
 */
import { config } from '../config.js';
import { ApiError, errors } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { getGroqClient, mapGroqError, requireGroqKey } from './ai-completion.js';
import { sanitizeMaterialText } from './material-analysis.js';
import { formatTimestamp } from '../lib/source-model.js';

/** Audio containers Lerno accepts (MIME + extension are both validated). */
export const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/webm',
  'video/webm',
  'audio/ogg',
  'application/octet-stream',
] as const;

export const TRANSCRIPTION_UNAVAILABLE_MESSAGE =
  "We couldn't transcribe this recording. The audio is saved — try again, or paste the text instead.";

export interface TranscriptSegment {
  startSeconds: number;
  endSeconds: number | null;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  durationSeconds: number | null;
  language: string | null;
  model: string;
}

interface GroqTranscriptionSegment {
  start?: unknown;
  end?: unknown;
  text?: unknown;
}

interface GroqTranscriptionResponse {
  text?: unknown;
  language?: unknown;
  duration?: unknown;
  segments?: unknown;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Normalizes the provider's verbose response into Lerno's own segment shape. */
export function normalizeTranscription(response: GroqTranscriptionResponse): TranscriptionResult {
  const segments: TranscriptSegment[] = [];
  if (Array.isArray(response.segments)) {
    for (const raw of response.segments as GroqTranscriptionSegment[]) {
      const start = numberOrNull(raw.start);
      const text = typeof raw.text === 'string' ? sanitizeMaterialText(raw.text) : '';
      if (start === null || !text) continue;
      segments.push({
        startSeconds: start,
        endSeconds: numberOrNull(raw.end),
        text,
      });
    }
  }
  const fallbackText = typeof response.text === 'string' ? sanitizeMaterialText(response.text) : '';
  const text = segments.length > 0 ? segments.map((segment) => segment.text).join(' ') : fallbackText;
  const lastSegment = segments.at(-1) ?? null;
  return {
    text,
    segments,
    durationSeconds: numberOrNull(response.duration) ?? lastSegment?.endSeconds ?? null,
    language: typeof response.language === 'string' ? response.language : null,
    model: config.groqTranscribeModel,
  };
}

/**
 * Transcribes one recording. Throws a safe error when transcription is not
 * possible (no key, upstream failure, empty transcript) — the caller turns that
 * into the source's `failed` state instead of continuing with empty material.
 */
export async function transcribeAudio(input: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): Promise<TranscriptionResult> {
  if (!config.groqApiKey) {
    throw errors.aiUnavailable(
      "Transcription is not available right now. The audio is saved — try again later or paste the text instead.",
    );
  }
  const apiKey = requireGroqKey();

  try {
    const file = new File([new Uint8Array(input.buffer)], input.filename, {
      type: input.mimeType || 'audio/mpeg',
    });
    const response = (await getGroqClient(apiKey).audio.transcriptions.create({
      file,
      model: config.groqTranscribeModel,
      response_format: 'verbose_json',
    })) as unknown as GroqTranscriptionResponse;

    const normalized = normalizeTranscription(response);
    if (normalized.text.replace(/\s/g, '').length < 20) {
      logger.info('source.transcription.empty', {
        action: 'source-transcribe',
        model: config.groqTranscribeModel,
        durationSeconds: normalized.durationSeconds,
      });
      throw errors.validation(
        "We couldn't hear enough speech in this recording. Check that the audio has clear speech.",
      );
    }
    logger.info('source.transcription.completed', {
      action: 'source-transcribe',
      model: config.groqTranscribeModel,
      durationSeconds: normalized.durationSeconds,
      segmentCount: normalized.segments.length,
      characters: normalized.text.length,
    });
    return normalized;
  } catch (error) {
    // Our own validation/unavailable errors are already student-facing.
    if (error instanceof ApiError) throw error;
    const mapped = mapGroqError(error);
    if (mapped.code === 'AI_TIMEOUT' || mapped.code === 'RATE_LIMITED') throw mapped;
    if (mapped.code === 'AI_UNAVAILABLE') throw mapped;
    throw errors.aiError(TRANSCRIPTION_UNAVAILABLE_MESSAGE);
  }
}

/** Provenance labels for transcript segments ("03:42 in recording"). */
export function segmentLabels(segments: TranscriptSegment[]): { marker: string; label: string }[] {
  return segments.map((segment) => ({
    marker: `t${Math.max(0, Math.floor(segment.startSeconds))}`,
    label: `${formatTimestamp(segment.startSeconds)} in recording`,
  }));
}
