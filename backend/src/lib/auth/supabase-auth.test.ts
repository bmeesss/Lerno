import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

const { getUser, createClient } = vi.hoisted(() => {
  const getUser = vi.fn();
  return { getUser, createClient: vi.fn(() => ({ auth: { getUser } })) };
});
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('../../config.js', () => ({
  config: { supabaseUrl: 'https://auth.test.invalid', supabaseAnonKey: 'local-anon-test-key' },
}));
import { createSupabaseAuthProvider } from './supabase-auth.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('production token verification with local Supabase SDK mock', () => {
  it('always asks Supabase Auth to verify the exact bearer, never trusts decoded claims', async () => {
    const token = jwt.sign(
      { sub: 'verified-user', client_id: 'local-mcp-client' },
      randomBytes(32),
      { audience: 'https://mcp.test.invalid/api/mcp' },
    );
    getUser.mockResolvedValueOnce({
      data: { user: { id: 'verified-user', email: 'a@test.invalid' } },
      error: null,
    });
    expect(await createSupabaseAuthProvider().verify(token)).toEqual({
      id: 'verified-user',
      email: 'a@test.invalid',
      oauthClient: true,
      audience: 'https://mcp.test.invalid/api/mcp',
    });
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledWith(token);
    expect(createClient).toHaveBeenCalledWith('https://auth.test.invalid', 'local-anon-test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it('keeps ordinary website tokens distinct from OAuth client tokens', async () => {
    const token = jwt.sign({ sub: 'verified-user' }, randomBytes(32));
    getUser.mockResolvedValue({
      data: { user: { id: 'verified-user', email: 'a@test.invalid' } },
      error: null,
    });
    expect(await createSupabaseAuthProvider().verify(token)).toMatchObject({
      id: 'verified-user',
      oauthClient: false,
    });
    const wrongSub = jwt.sign({ sub: 'another-user' }, randomBytes(32));
    expect(await createSupabaseAuthProvider().verify(wrongSub)).toBeNull();
    const emptyClient = jwt.sign({ sub: 'verified-user', client_id: '' }, randomBytes(32));
    expect(await createSupabaseAuthProvider().verify(emptyClient)).toBeNull();
  });

  it('rejects invalid, expired or revoked tokens when the provider rejects them', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'JWT expired' } });
    expect(await createSupabaseAuthProvider().verify('expired-access-token')).toBeNull();
    expect(await createSupabaseAuthProvider().verify('invalid-access-token')).toBeNull();
    expect(getUser).toHaveBeenNthCalledWith(1, 'expired-access-token');
    expect(getUser).toHaveBeenNthCalledWith(2, 'invalid-access-token');
  });
});
