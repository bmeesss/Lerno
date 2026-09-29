import { z } from 'zod';

/**
 * Numeric env helper: empty strings (a common shell/Render mistake) fall back to
 * the default instead of coercing to `0` and failing validation.
 */
function boundedNumber(defaultValue: number, min: number, max: number, integer: boolean) {
  const base = integer
    ? z.coerce.number().int().min(min).max(max)
    : z.coerce.number().min(min).max(max);
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    base.default(defaultValue),
  );
}

/** String env helper: empty values fall back to the default. */
function stringFromEnv(defaultValue: string) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).default(defaultValue),
  );
}

/** Enum env helper: empty strings fall back to the default. */
function boundedEnum<T extends string>(values: readonly [T, ...T[]], defaultValue: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.enum(values).default(defaultValue),
  );
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  SUPABASE_URL: z.string().url().optional().or(z.literal('')),
  SUPABASE_ANON_KEY: z.string().optional().or(z.literal('')),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().or(z.literal('')),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  AUTH_JWT_SECRET: z.string().optional().or(z.literal('')),
  /**
   * Canonical public origin of this backend (e.g. https://lerno-backend.onrender.com).
   * Used for OAuth protected-resource metadata. Never fall back to request headers.
   */
  PUBLIC_BACKEND_URL: z.string().url().optional().or(z.literal('')),
  /**
   * Groq API key for Lerno AI (server-side only — never shipped to the
   * frontend or committed). Empty disables the AI endpoints with a clean
   * "not available" error.
   */
  GROQ_API_KEY: z.string().optional().or(z.literal('')),
  /** Groq chat model. Central so it can be swapped without code changes. */
  GROQ_MODEL: stringFromEnv('openai/gpt-oss-120b'),
  /**
   * Vision-capable Groq model used for image OCR. Only called when a student
   * uploads an image, and only from the server (key never leaves the backend).
   */
  GROQ_VISION_MODEL: stringFromEnv('meta-llama/llama-4-scout-17b-16e-instruct'),
  /** Groq transcription model used for audio sources (never stored, only its text). */
  GROQ_TRANSCRIBE_MODEL: stringFromEnv('whisper-large-v3'),
  /** Upper bound on tokens the model may generate for one answer. */
  GROQ_MAX_OUTPUT_TOKENS: boundedNumber(2048, 256, 8192, true),
  /** Sampling temperature — low keeps explanations predictable. */
  GROQ_TEMPERATURE: boundedNumber(0.6, 0, 2, false),
  /** Hard timeout for one upstream Groq call. */
  GROQ_TIMEOUT_MS: boundedNumber(30_000, 1_000, 120_000, true),
  /** Retries inside the Groq SDK (idempotent chat calls only). */
  GROQ_MAX_RETRIES: boundedNumber(1, 0, 3, true),
  /**
   * Reasoning effort for reasoning models (GPT-OSS on Groq).
   *
   * `auto` (default) uses the per-task defaults from `services/ai-reasoning.ts`:
   * low for short explanations/hints, medium for math, complex evaluation and
   * generation. Set a concrete value to force one level for every request — that
   * is a measurement switch, not a quality setting. Non-reasoning models ignore
   * it (no reasoning_effort is sent).
   */
  GROQ_REASONING_EFFORT: boundedEnum(['auto', 'low', 'medium', 'high'] as const, 'auto'),
  /**
   * Ask Groq for JSON output on structured tasks. Output is always parsed
   * defensively and validated with Zod — this only helps the model comply.
   */
  GROQ_JSON_MODE: boundedEnum(['true', 'false'], 'true').transform((v) => v === 'true'),
  /** Max cards sent to the model as set context (larger sets are trimmed). */
  AI_CONTEXT_MAX_CARDS: boundedNumber(60, 5, 200, true),
  /** Hard ceiling on the characters of one set context sent to the model. */
  AI_CONTEXT_MAX_CHARS: boundedNumber(12_000, 1_000, 40_000, true),
  /** Lerno AI quota per authenticated user (fallback: IP) per window. */
  AI_RATE_LIMIT_MAX: boundedNumber(20, 1, 10_000, true),
  /** Window for the per-user Lerno AI quota. */
  AI_RATE_LIMIT_WINDOW_MS: boundedNumber(5 * 60 * 1000, 1_000, 60 * 60 * 1000, true),
  /** Wider per-IP quota so one network cannot burn the shared Groq budget. */
  AI_RATE_LIMIT_IP_MAX: boundedNumber(60, 1, 100_000, true),
  /* ------------------------------ sources ------------------------------ */
  /** Hard upload ceilings per source kind (bytes). Anything bigger is rejected. */
  SOURCE_MAX_PDF_BYTES: boundedNumber(15 * 1024 * 1024, 1024, 100 * 1024 * 1024, true),
  SOURCE_MAX_PPTX_BYTES: boundedNumber(25 * 1024 * 1024, 1024, 100 * 1024 * 1024, true),
  SOURCE_MAX_IMAGE_BYTES: boundedNumber(10 * 1024 * 1024, 1024, 100 * 1024 * 1024, true),
  SOURCE_MAX_AUDIO_BYTES: boundedNumber(25 * 1024 * 1024, 1024, 100 * 1024 * 1024, true),
  /**
   * Optional YouTube Data API v3 key. When set, Lerno reads public video
   * metadata (title, channel, duration) from the official API; without it only
   * the public oEmbed metadata is used and the duration stays unknown. Captions
   * are never scraped — the student pastes them, or the source fails honestly.
   */
  YOUTUBE_API_KEY: z.string().optional().or(z.literal('')),
  HEALTH_CHECK_DB: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

const parsed = envSchema.parse(process.env);

const supabaseUrl = parsed.SUPABASE_URL ?? '';
const supabaseAnonKey = parsed.SUPABASE_ANON_KEY ?? '';
const supabaseServiceRoleKey = parsed.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** True when real Supabase credentials are present (production code path). */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * Development data mode: no Supabase credentials, not production. Data and auth
 * are served by in-memory stores so the product runs without external
 * infrastructure. Never used in production.
 */
export const isDevDataMode = !isSupabaseConfigured && parsed.NODE_ENV !== 'production';

if (parsed.NODE_ENV === 'production' && !isSupabaseConfigured) {
  throw new Error(
    'SUPABASE_URL and SUPABASE_ANON_KEY are required in production. ' +
      'Development data mode must never be used in production.',
  );
}
if (isSupabaseConfigured) {
  const issuerOrigin = new URL(supabaseUrl);
  if (
    ![issuerOrigin.origin, `${issuerOrigin.origin}/`].includes(supabaseUrl) ||
    issuerOrigin.username ||
    issuerOrigin.password ||
    (parsed.NODE_ENV === 'production' && issuerOrigin.protocol !== 'https:')
  ) {
    throw new Error('SUPABASE_URL must be a bare HTTPS origin in production');
  }
}

// Discovery URLs are security-sensitive. Never construct them from an
// untrusted Host header in production (authorization-server mix-up).
if (parsed.PUBLIC_BACKEND_URL) {
  const url = new URL(parsed.PUBLIC_BACKEND_URL);
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    ![url.origin, `${url.origin}/`].includes(parsed.PUBLIC_BACKEND_URL) ||
    ((parsed.NODE_ENV === 'production' || isSupabaseConfigured) && url.protocol !== 'https:')
  ) {
    throw new Error('PUBLIC_BACKEND_URL must be a bare HTTPS origin in production');
  }
}
// A real Supabase issuer must never be paired with metadata assembled from
// request headers, even if NODE_ENV was accidentally left at development.
if ((parsed.NODE_ENV === 'production' || isSupabaseConfigured) && !parsed.PUBLIC_BACKEND_URL) {
  throw new Error(
    'PUBLIC_BACKEND_URL is required with Supabase or in production for OAuth discovery',
  );
}

export const config = {
  nodeEnv: parsed.NODE_ENV,
  isProduction: parsed.NODE_ENV === 'production',
  isTest: parsed.NODE_ENV === 'test',
  port: parsed.PORT,
  supabaseUrl,
  supabaseAnonKey,
  supabaseServiceRoleKey,
  frontendUrls: parsed.FRONTEND_URL.split(',')
    .map((url) => url.trim())
    .filter(Boolean),
  publicBackendUrl: parsed.PUBLIC_BACKEND_URL || null,
  authJwtSecret: parsed.AUTH_JWT_SECRET,
  healthCheckDb: parsed.HEALTH_CHECK_DB,
  /** Server-only Groq credentials (Lerno AI). */
  groqApiKey: parsed.GROQ_API_KEY ?? '',
  groqModel: parsed.GROQ_MODEL,
  /** Vision model for image OCR; transcription model for audio sources. */
  groqVisionModel: parsed.GROQ_VISION_MODEL,
  groqTranscribeModel: parsed.GROQ_TRANSCRIBE_MODEL,
  groqMaxOutputTokens: parsed.GROQ_MAX_OUTPUT_TOKENS,
  groqTemperature: parsed.GROQ_TEMPERATURE,
  groqTimeoutMs: parsed.GROQ_TIMEOUT_MS,
  groqMaxRetries: parsed.GROQ_MAX_RETRIES,
  /** auto = per-task reasoning defaults; low|medium|high = force one level. */
  groqReasoningEffort: parsed.GROQ_REASONING_EFFORT,
  groqJsonMode: parsed.GROQ_JSON_MODE,
  /** Bounds for AI study-set context sent to the model. */
  aiContextMaxCards: parsed.AI_CONTEXT_MAX_CARDS,
  aiContextMaxChars: parsed.AI_CONTEXT_MAX_CHARS,
  /** Optional official YouTube Data API key (metadata only; never captions). */
  youtubeApiKey: parsed.YOUTUBE_API_KEY ?? '',
  /** Upload ceilings per source kind (bytes). */
  sourceMaxPdfBytes: parsed.SOURCE_MAX_PDF_BYTES,
  sourceMaxPptxBytes: parsed.SOURCE_MAX_PPTX_BYTES,
  sourceMaxImageBytes: parsed.SOURCE_MAX_IMAGE_BYTES,
  sourceMaxAudioBytes: parsed.SOURCE_MAX_AUDIO_BYTES,
  /** Lerno AI quota (per user, with a wider per-IP guard). */
  aiRateLimitMax: parsed.AI_RATE_LIMIT_MAX,
  aiRateLimitWindowMs: parsed.AI_RATE_LIMIT_WINDOW_MS,
  aiRateLimitIpMax: parsed.AI_RATE_LIMIT_IP_MAX,
} as const;

/** Secret used to sign dev-mode access tokens. */
export function devJwtSecret(): string {
  return config.authJwtSecret || 'lerno-dev-secret-do-not-use-in-production';
}
