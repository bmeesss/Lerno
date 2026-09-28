import { afterEach, describe, expect, it, vi } from 'vitest';

// Lerno AI settings must be configurable through real environment variables.
// Each test loads a fresh config module so env changes take effect.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadConfig(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [key, value] of Object.entries({
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://auth.test.invalid',
    SUPABASE_ANON_KEY: 'local-public-test-key',
    PUBLIC_BACKEND_URL: 'https://mcp.test.invalid',
    ...env,
  })) {
    vi.stubEnv(key, value);
  }
  return import('./config.js');
}

describe('Lerno AI configuration', () => {
  it('defaults to a sane model, output budget and temperature', async () => {
    const { config } = await loadConfig();
    expect(config.groqModel).toBe('openai/gpt-oss-120b');
    expect(config.groqMaxOutputTokens).toBe(2048);
    expect(config.groqTemperature).toBeCloseTo(0.6);
    expect(config.groqTimeoutMs).toBe(30_000);
    expect(config.groqApiKey).toBe('');
  });

  it('reads GROQ_MODEL, GROQ_MAX_OUTPUT_TOKENS and GROQ_TEMPERATURE', async () => {
    const { config } = await loadConfig({
      GROQ_MODEL: 'llama-3.3-70b-versatile',
      GROQ_MAX_OUTPUT_TOKENS: '1024',
      GROQ_TEMPERATURE: '0.2',
      GROQ_TIMEOUT_MS: '15000',
      GROQ_API_KEY: 'test-key-placeholder',
    });

    expect(config.groqModel).toBe('llama-3.3-70b-versatile');
    expect(config.groqMaxOutputTokens).toBe(1024);
    expect(config.groqTemperature).toBeCloseTo(0.2);
    expect(config.groqTimeoutMs).toBe(15_000);
    expect(config.groqApiKey).toBe('test-key-placeholder');
  });

  it('defaults the reasoning effort to the per-task policy', async () => {
    const { config } = await loadConfig();
    expect(config.groqReasoningEffort).toBe('auto');
  });

  it('can force one reasoning level for a measurement run', async () => {
    const { config } = await loadConfig({ GROQ_REASONING_EFFORT: 'medium' });
    expect(config.groqReasoningEffort).toBe('medium');
  });

  it('treats empty values as "unset" and keeps the defaults', async () => {
    const { config } = await loadConfig({
      GROQ_MODEL: '',
      GROQ_MAX_OUTPUT_TOKENS: '',
      GROQ_TEMPERATURE: '',
      GROQ_REASONING_EFFORT: '',
    });

    expect(config.groqModel).toBe('openai/gpt-oss-120b');
    expect(config.groqMaxOutputTokens).toBe(2048);
    expect(config.groqTemperature).toBeCloseTo(0.6);
    expect(config.groqReasoningEffort).toBe('auto');
  });

  it('rejects out-of-range values instead of silently misbehaving', async () => {
    await expect(loadConfig({ GROQ_MAX_OUTPUT_TOKENS: '99999' })).rejects.toThrow();
    await expect(loadConfig({ GROQ_TEMPERATURE: '5' })).rejects.toThrow();
    await expect(loadConfig({ GROQ_MAX_OUTPUT_TOKENS: 'not-a-number' })).rejects.toThrow();
    await expect(loadConfig({ GROQ_REASONING_EFFORT: 'extreme' })).rejects.toThrow();
  });

  it('configures the AI quota separately from normal API limits', async () => {
    const { config } = await loadConfig({
      AI_RATE_LIMIT_MAX: '8',
      AI_RATE_LIMIT_WINDOW_MS: '60000',
      AI_RATE_LIMIT_IP_MAX: '40',
    });

    expect(config.aiRateLimitMax).toBe(8);
    expect(config.aiRateLimitWindowMs).toBe(60_000);
    expect(config.aiRateLimitIpMax).toBe(40);
  });

  it('never ships the Groq key to the frontend config surface', async () => {
    const { config } = await loadConfig({ GROQ_API_KEY: 'test-key-placeholder' });
    // The key exists server-side only: there is no VITE_-style export, and the
    // value is not part of any response helper.
    expect(Object.keys(config)).toContain('groqApiKey');
    expect(config.groqApiKey).toBe('test-key-placeholder');
    expect(config.frontendUrls).not.toContain('test-key-placeholder');
  });
});
