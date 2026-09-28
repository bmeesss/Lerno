/**
 * Safe parsing of structured AI output (#11).
 *
 * The model is asked for JSON, but its answer is *never* trusted:
 *   1. strip markdown fences and surrounding prose
 *   2. extract the first balanced JSON object (or array)
 *   3. JSON.parse in a try/catch
 *   4. validate with a Zod schema before anything is returned to a client
 *
 * Any failure yields a typed `invalid` result — the caller turns that into a
 * friendly API error. No unvalidated AI JSON ever leaves the backend.
 */
import type { z } from 'zod';

export interface AiJsonSuccess<T> {
  ok: true;
  data: T;
}

export interface AiJsonFailure {
  ok: false;
  /** Short reason for logs/errors — never contains model output. */
  reason: 'empty' | 'no-json' | 'malformed' | 'schema';
}

export type AiJsonResult<T> = AiJsonSuccess<T> | AiJsonFailure;

/** Removes ```json fences and trims stray prose around the JSON. */
function stripFences(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1]! : text;
  return body.trim();
}

/**
 * Returns the substring of the first balanced `{…}` or `[…]` block, so prose
 * before/after the JSON cannot break parsing.
 */
export function extractJsonBlock(text: string): string | null {
  const source = stripFences(text);
  const start = source.search(/[[{]/);
  if (start === -1) return null;

  const open = source[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return null;
}

/** Parses and validates model output; returns a typed result instead of throwing. */
export function parseAiJson<T>(text: string, schema: z.ZodType<T>): AiJsonResult<T> {
  if (!text || text.trim() === '') return { ok: false, reason: 'empty' };

  const block = extractJsonBlock(text);
  if (!block) return { ok: false, reason: 'no-json' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) return { ok: false, reason: 'schema' };

  return { ok: true, data: validated.data };
}

export function describeAiJsonFailure(result: AiJsonFailure): string {
  switch (result.reason) {
    case 'empty':
      return 'The AI returned an empty response. Please try again.';
    case 'no-json':
    case 'malformed':
      return 'The AI returned an unreadable response. Please try again.';
    default:
      return 'The AI returned a response we could not use. Please try again.';
  }
}
