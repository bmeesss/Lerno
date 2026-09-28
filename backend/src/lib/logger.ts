/**
 * Structured logging for the API.
 *
 * Rules (security):
 * - Never log API keys, bearer tokens, cookies, or raw upstream error bodies.
 * - Never log the full user prompt or the full AI answer — only lengths.
 * - Never log personal data (email, name, profile fields).
 *
 * Everything is emitted as single-line JSON so it is easy to grep and safe to
 * ship to a log drain.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

const REDACTED = '[redacted]';

/**
 * Keys whose values must never appear in a log line. Deliberately narrow:
 * token *counts* (`inputTokens`) are safe, bearer/API tokens are not.
 */
const SENSITIVE_KEY =
  /(api_?key|secret|password|authorization|bearer|cookie|email|access_?token|refresh_?token|prompt|reply|content|message)/i;

/**
 * Drops values of sensitive-looking fields. Callers should already avoid
 * passing them; this is the safety net for mistakes.
 */
function redact(fields: LogFields): LogFields {
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = SENSITIVE_KEY.test(key) ? REDACTED : value;
  }
  return safe;
}

/**
 * Logs are noise in test output, but some tests assert *what* is logged
 * (for example: never the API key). Set `LOG_IN_TESTS=true` to opt in.
 */
function enabled(): boolean {
  return process.env.NODE_ENV !== 'test' || process.env.LOG_IN_TESTS === 'true';
}

function write(level: LogLevel, event: string, fields: LogFields): void {
  if (!enabled()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...redact(fields),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (event: string, fields: LogFields = {}): void => write('info', event, fields),
  warn: (event: string, fields: LogFields = {}): void => write('warn', event, fields),
  error: (event: string, fields: LogFields = {}): void => write('error', event, fields),
};
