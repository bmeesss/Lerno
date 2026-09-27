import { afterEach, describe, expect, it, vi } from 'vitest';

// Import only this local module; no HTTP requests or provider credentials.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries({
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://auth.test.invalid',
    SUPABASE_ANON_KEY: 'local-public-test-key',
    PUBLIC_BACKEND_URL: 'https://mcp.test.invalid',
    ...env,
  }))
    vi.stubEnv(key, value);
  return import('./config.js');
}

describe('OAuth security configuration', () => {
  it('requires a fixed public origin in production or whenever Supabase is configured', async () => {
    await expect(loadConfig({ PUBLIC_BACKEND_URL: '' })).rejects.toThrow(/PUBLIC_BACKEND_URL/);
    await expect(loadConfig({ NODE_ENV: 'development', PUBLIC_BACKEND_URL: '' })).rejects.toThrow(
      /PUBLIC_BACKEND_URL/,
    );
  });

  it('rejects credentialed, non-HTTPS, path or query URLs in production', async () => {
    await expect(loadConfig({ SUPABASE_URL: 'http://auth.test.invalid' })).rejects.toThrow(
      /SUPABASE_URL/,
    );
    await expect(loadConfig({ SUPABASE_URL: 'https://auth.test.invalid/auth/v1' })).rejects.toThrow(
      /SUPABASE_URL/,
    );
    for (const value of [
      'http://mcp.test.invalid',
      'https://user:pass@mcp.test.invalid',
      'https://mcp.test.invalid/api/mcp',
      'https://mcp.test.invalid/../',
      'https://mcp.test.invalid/%2e/',
      'https://mcp.test.invalid/?return=evil',
      'https://mcp.test.invalid/#fragment',
    ])
      await expect(loadConfig({ PUBLIC_BACKEND_URL: value })).rejects.toThrow(/PUBLIC_BACKEND_URL/);
    const { config } = await loadConfig({});
    expect(config.publicBackendUrl).toBe('https://mcp.test.invalid');
  });
});
