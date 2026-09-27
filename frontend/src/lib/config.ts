/** Frontend runtime configuration from Vite env vars (never secrets). */

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

export const config = {
  apiBaseUrl: apiBase.replace(/\/$/, ''),
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '',
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
} as const;
