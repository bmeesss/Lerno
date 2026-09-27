import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  SUPABASE_URL: z.string().url().optional().or(z.literal('')),
  SUPABASE_ANON_KEY: z.string().optional().or(z.literal('')),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().or(z.literal('')),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  AUTH_JWT_SECRET: z.string().optional().or(z.literal('')),
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
  authJwtSecret: parsed.AUTH_JWT_SECRET,
  healthCheckDb: parsed.HEALTH_CHECK_DB,
} as const;

/** Secret used to sign dev-mode access tokens. */
export function devJwtSecret(): string {
  return config.authJwtSecret || 'lerno-dev-secret-do-not-use-in-production';
}
