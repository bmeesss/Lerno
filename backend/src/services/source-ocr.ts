/**
 * Image → text (OCR).
 *
 * Lerno reads images with the vision model of the *existing* Groq layer: no extra
 * OCR service, no extra API key, and the key stays server-side. The Cerebras
 * fallback serves chat completions only, so OCR opts out of it explicitly. The
 * model is told to transcribe verbatim — never to explain, summarize or answer —
 * and its output is treated as untrusted text like any other source.
 *
 * Honesty rules this module enforces:
 *  - an image without enough readable text fails with a clear message
 *    ("We couldn't detect enough text in this image.") instead of producing a
 *    source that pretends OCR worked
 *  - the model's chatter ("I can see a page with…") is rejected as text
 *  - nothing is stored here; the caller decides what to do with the text
 */
import { config } from '../config.js';
import { errors } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { requestChat } from './ai-completion.js';
import { hasUsableMaterial, sanitizeMaterialText } from './material-analysis.js';
import { AI_TASKS, taskMessages } from './ai-prompts.js';
import { guardSecretLeak } from '../lib/ai-guard.js';

/** MIME types accepted for image sources (extension is checked separately). */
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] as const;

/** Deliberately reuses the material threshold: fewer readable characters is not material. */
export const OCR_MESSAGE_NO_TEXT =
  "We couldn't detect enough text in this image. Try a sharper photo, crop out the background, or paste the text instead.";

export interface OcrResult {
  text: string;
  engine: string;
  characters: number;
}

/** Sentences a model adds when it did not really read the image. */
const META_REPLY =
  /^(?:i can(?:'|no)t|i'm sorry|sorry|as an ai|the image (?:shows|contains|appears)|this image (?:shows|contains)|er is geen tekst|ik kan geen tekst|de afbeelding (?:bevat|toont)|er staat geen leesbare tekst)/i;

/** Strips markdown fences and obvious model chatter from OCR output. */
export function cleanOcrText(raw: string): string {
  const withoutFences = raw
    .replace(/^\s*```[a-z]*\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  if (META_REPLY.test(withoutFences) && !/\n/.test(withoutFences.slice(0, 80))) {
    return '';
  }
  return sanitizeMaterialText(withoutFences);
}

/**
 * Reads the text of one image. Throws a validation error with the exact student
 * message when there is not enough usable text.
 */
export async function ocrImage(input: { buffer: Buffer; mimeType: string }): Promise<OcrResult> {
  if (!IMAGE_MIME_TYPES.includes(input.mimeType as (typeof IMAGE_MIME_TYPES)[number])) {
    throw errors.validation('Choose a PNG, JPG or WEBP image.');
  }
  if (!config.groqApiKey) {
    throw errors.aiUnavailable(
      "We couldn't read this image right now. Try again later or paste the text instead.",
    );
  }

  const task = AI_TASKS['source-ocr'];
  const dataUrl = `data:${input.mimeType};base64,${input.buffer.toString('base64')}`;
  const [systemMessage] = taskMessages('source-ocr', '', 'source');
  const result = await requestChat({
    action: 'source-ocr',
    model: config.groqVisionModel,
    // Vision is a Groq-only model: never send an image to the text-only
    // fallback provider (there is no equivalent vision model there).
    fallback: false,
    messages: [
      systemMessage!,
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Transcribe every readable word in this image, in reading order. Output only the text. If there is no readable text, output exactly: NO_TEXT',
          },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    maxOutputTokens: task.maxOutputTokens,
    temperature: task.temperature,
  });

  const text = cleanOcrText(guardSecretLeak(result.text).replace(/^NO_TEXT$/i, '').trim());
  if (!hasUsableMaterial(text)) {
    logger.info('source.ocr.empty', {
      action: 'source-ocr',
      model: config.groqVisionModel,
      characters: text.length,
    });
    throw errors.validation(OCR_MESSAGE_NO_TEXT);
  }

  return { text, engine: `groq:${config.groqVisionModel}`, characters: text.length };
}
