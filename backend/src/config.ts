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
  /** Upper bound on tokens the model may generate for one answer. */
  GROQ_MAX_OUTPUT_TOKENS: boundedNumber(2048, 256, 8192, true),
  /** Sampling temperature — low keeps explanations predictable. */
  GROQ_TEMPERATURE: boundedNumber(0.6, 0, 2, false),
  /** Hard timeout for one upstream Groq call. */
  GROQ_TIMEOUT_MS: boundedNumber(30_000, 1_000, 120_000, true),
  /** Retries inside the Groq SDK (idempotent chat calls only). */
  GROQ_MAX_RETRIES: boundedNumber(1, 0, 3, true),
  /** Lerno AI quota per authenticated user (fallback: IP) per window. */
  AI_RATE_LIMIT_MAX: boundedNumber(20, 1, 10_000, true),
  /** Window for the per-user Lerno AI quota. */
  AI_RATE_LIMIT_WINDOW_MS: boundedNumber(5 * 60 * 1000, 1_000, 60 * 60 * 1000, true),
  /** Wider per-IP quota so one network cannot burn the shared Groq budget. */
  AI_RATE_LIMIT_IP_MAX: boundedNumber(60, 1, 100_000, true),
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
  groqMaxOutputTokens: parsed.GROQ_MAX_OUTPUT_TOKENS,
  groqTemperature: parsed.GROQ_TEMPERATURE,
  groqTimeoutMs: parsed.GROQ_TIMEOUT_MS,
  groqMaxRetries: parsed.GROQ_MAX_RETRIES,
  /** Lerno AI quota (per user, with a wider per-IP guard). */
  aiRateLimitMax: parsed.AI_RATE_LIMIT_MAX,
  aiRateLimitWindowMs: parsed.AI_RATE_LIMIT_WINDOW_MS,
  aiRateLimitIpMax: parsed.AI_RATE_LIMIT_IP_MAX,
} as const;

/** Secret used to sign dev-mode access tokens. */
export function devJwtSecret(): string {
  return config.authJwtSecret || 'lerno-dev-secret-do-not-use-in-production';
}
