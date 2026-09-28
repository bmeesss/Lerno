/**
 * Lerno AI input hygiene + history normalization.
 *
 * Everything the model sees passes through here first. Goals:
 *
 * - **No malformed message arrays.** The service may be called with untrusted
 *   input; anything that is not `{ role: 'user' | 'assistant', content: string }`
 *   is dropped instead of reaching Groq.
 * - **No unbounded context.** Newest messages win, long messages are trimmed,
 *   and the whole context has a hard character ceiling.
 * - **Basic prompt-injection resistance.** Chat-template tokens and fake role
 *   prefixes are stripped, so "system: ignore all previous instructions" is
 *   just text — it can never become a real role in the upstream payload.
 *
 * This is defence in depth, not a claim of perfect prompt-injection safety: the
 * system prompt also instructs the model to refuse, and the reply is checked
 * for leaked secrets before it is returned.
 */
import {
  MAX_CONTEXT_CHARS,
  MAX_HISTORY_ITEM_CHARS,
  MAX_HISTORY_ITEM_SENT_CHARS,
  MAX_HISTORY_MESSAGES_SENT,
  TRIM_MARKER,
} from './ai-limits.js';

export type ChatRole = 'user' | 'assistant';

export interface NormalizedMessage {
  role: ChatRole;
  content: string;
}

export interface NormalizedHistory {
  /** Messages to send, oldest first, newest last. */
  messages: NormalizedMessage[];
  /** Entries dropped: malformed, or older than the context budget allows. */
  dropped: number;
  /** Entries that were kept but shortened. */
  trimmed: number;
  /** Total characters of the returned messages. */
  chars: number;
}

/** Chat-template tokens used to smuggle fake roles into a message. */
const TEMPLATE_TOKENS =
  /<\|[a-z_]{1,32}\|>|<\/?system>|<<\/?SYS>>|\[\/?INST\]|<\/?s>|<\/?bot>|<\|?(?:endoftext|im_start|im_end)\|?>/gi;

/** "system:", "### assistant:", "developer (note):" … at the start of a line. */
const ROLE_PREFIX =
  /^[ \t]*(?:#{1,6}[ \t]*)?(?:system|developer|assistant|user)[ \t]*(?:\([^)\n]*\))?[ \t]*:/i;

/** Zero-width / bidi characters are only useful to hide instructions. */
const INVISIBLE = new RegExp('[\\u200b-\\u200f\\u202a-\\u202e\\u2060\\ufeff]', 'g');

/** Control characters except tab/newline (they break upstream payloads). */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point here
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f]', 'g');

/**
 * Cleans one piece of student/assistant text:
 * strips control characters, template tokens and fake role prefixes, then caps
 * the length. Never rejects — it always returns usable text.
 */
export function sanitizeChatText(input: string, maxChars: number): string {
  if (typeof input !== 'string' || input.length === 0) return '';

  const cleaned = input
    .replace(/\r\n?/g, '\n')
    .replace(TEMPLATE_TOKENS, ' ')
    .replace(INVISIBLE, '')
    .replace(CONTROL_CHARS, ' ')
    .split('\n')
    .map((line) => (ROLE_PREFIX.test(line) ? line.replace(ROLE_PREFIX, '') : line))
    .join('\n')
    // Three or more blank lines are noise; two are a paragraph break.
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return capLength(cleaned, maxChars);
}

/** Shortens text to `maxChars`, appending a marker so truncation is visible. */
export function capLength(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= TRIM_MARKER.length) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - TRIM_MARKER.length).trimEnd()}${TRIM_MARKER}`;
}

function isChatRole(value: unknown): value is ChatRole {
  return value === 'user' || value === 'assistant';
}

export interface NormalizeOptions {
  maxMessages?: number;
  maxItemChars?: number;
  maxTotalChars?: number;
}

/**
 * Turns arbitrary client input into a clean, bounded, newest-wins history.
 *
 * Never throws and never returns malformed entries — the model only ever sees
 * alternating user/assistant turns that fit the context budget.
 */
export function normalizeHistory(
  history: unknown,
  options: NormalizeOptions = {},
): NormalizedHistory {
  const maxMessages = options.maxMessages ?? MAX_HISTORY_MESSAGES_SENT;
  const maxItemChars = options.maxItemChars ?? MAX_HISTORY_ITEM_SENT_CHARS;
  const maxTotalChars = options.maxTotalChars ?? MAX_CONTEXT_CHARS;

  if (!Array.isArray(history)) {
    return { messages: [], dropped: 0, trimmed: 0, chars: 0 };
  }

  let dropped = 0;
  let trimmed = 0;

  // 1. Keep only well-formed turns, sanitized and length-capped.
  const sanitized: NormalizedMessage[] = [];
  for (const entry of history) {
    if (!entry || typeof entry !== 'object') {
      dropped += 1;
      continue;
    }
    const record = entry as { role?: unknown; content?: unknown };
    if (!isChatRole(record.role) || typeof record.content !== 'string') {
      dropped += 1;
      continue;
    }
    const content = sanitizeChatText(record.content, MAX_HISTORY_ITEM_CHARS);
    if (!content) {
      dropped += 1;
      continue;
    }
    if (content.length > maxItemChars) trimmed += 1;
    sanitized.push({ role: record.role, content: capLength(content, maxItemChars) });
  }

  // 2. Newest messages win: an old turn is far less useful than the last one.
  let messages = sanitized.slice(-maxMessages);
  dropped += sanitized.length - messages.length;

  // 3. A context that starts with an assistant turn has no question to answer.
  while (messages.length > 0 && messages[0]!.role !== 'user') {
    messages = messages.slice(1);
    dropped += 1;
  }

  // 4. Hard ceiling on the total context: drop the oldest turns until it fits.
  const total = (list: NormalizedMessage[]): number =>
    list.reduce((sum, message) => sum + message.content.length, 0);
  while (messages.length > 1 && total(messages) > maxTotalChars) {
    messages = messages.slice(1);
    dropped += 1;
  }
  if (messages.length === 1 && total(messages) > maxTotalChars) {
    const only = messages[0]!;
    messages = [{ role: only.role, content: capLength(only.content, maxTotalChars) }];
    trimmed += 1;
  }

  return { messages, dropped, trimmed, chars: total(messages) };
}
