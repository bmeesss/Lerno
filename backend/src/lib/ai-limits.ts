/**
 * Lerno AI request limits — one place, shared by validation and the service.
 *
 * Two layers, deliberately:
 *
 * 1. **Accepted** limits (enforced by Zod) reject absurd payloads early so a
 *    single request can never allocate or forward an unbounded body.
 * 2. **Sent** limits (enforced when the Groq payload is built) shape the actual
 *    context: newest messages win, long messages are trimmed, and the total
 *    context has a hard ceiling.
 *
 * The accepted limits are strictly looser than the sent limits, so a long
 * conversation is *trimmed* instead of rejected: an earlier AI answer that is
 * longer than the new-message limit must never turn into a 400.
 */

/** Max characters of the student's new message (rejected above this). */
export const MAX_USER_MESSAGE_CHARS = 2000;

/** Max characters of a single history entry (rejected above this). */
export const MAX_HISTORY_ITEM_CHARS = 8000;

/** Max number of history entries accepted in one request (rejected above). */
export const MAX_HISTORY_MESSAGES_ACCEPTED = 30;

/** Hard ceiling on the total history payload accepted (rejected above). */
export const MAX_HISTORY_TOTAL_CHARS = 48_000;

/** Max number of prior messages sent to Groq (newest ones win). */
export const MAX_HISTORY_MESSAGES_SENT = 12;

/** Max characters per history message sent to Groq (longer ones are trimmed). */
export const MAX_HISTORY_ITEM_SENT_CHARS = 4000;

/**
 * Hard ceiling for the whole conversation context (system prompt excluded).
 * Older messages are dropped until the budget fits; if the *newest* message
 * alone exceeds it, the oldest kept messages are dropped first and the tail is
 * never lost.
 */
export const MAX_CONTEXT_CHARS = 16_000;

/** Marker appended to trimmed messages so the model knows text was cut. */
export const TRIM_MARKER = ' […]';

/**
 * Hard ceiling on the serialized request body (characters). The global JSON
 * parser allows 1 MB — far more than a chat message plus history can legitimately
 * be — so the AI route rejects anything bigger before parsing the schema.
 */
export const MAX_AI_BODY_CHARS = 96_000;
