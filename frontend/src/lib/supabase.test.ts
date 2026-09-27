import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, getRefreshToken, setTokens } from './api';
import { attachLernoSession } from './supabase';

beforeEach(() => localStorage.clear());

describe('Lerno session used on the OAuth consent page', () => {
  it('persists a rotated refresh token after attaching an expired session', async () => {
    setTokens('old-access', 'old-refresh');
    const setSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: 'new-access', refresh_token: 'new-refresh' } },
      error: null,
    });
    expect(await attachLernoSession({ auth: { setSession } } as never)).toBe(true);
    expect(setSession).toHaveBeenCalledWith({
      access_token: 'old-access',
      refresh_token: 'old-refresh',
    });
    expect(getAccessToken()).toBe('new-access');
    expect(getRefreshToken()).toBe('new-refresh');
  });

  it('does not attach or overwrite tokens after provider rejection', async () => {
    setTokens('old-access', 'old-refresh');
    const setSession = vi
      .fn()
      .mockResolvedValue({ data: { session: null }, error: { message: 'expired' } });
    expect(await attachLernoSession({ auth: { setSession } } as never)).toBe(false);
    expect(getAccessToken()).toBe('old-access');
    expect(getRefreshToken()).toBe('old-refresh');
  });
});
