import { describe, expect, it } from 'vitest';
import { safeNext } from '../auth/safeNext';
import { safeOAuthRedirect } from './redirect';

describe('OAuth callback and login continuation validation', () => {
  it('requires registered callback origin and path, HTTPS or loopback', () => {
    const registered = 'https://client.example/callback';
    expect(
      safeOAuthRedirect('https://client.example/callback?code=abc&state=xyz', registered),
    ).toBe(true);
    for (const target of [
      'https://evil.example/callback?code=abc',
      'https://client.example/other?code=abc',
      'https://client.example.evil.test/callback?code=abc',
      'http://client.example/callback?code=abc',
      'javascript:alert(1)',
      'https://user@client.example/callback',
      'https://client.example/callback#code=abc',
    ])
      expect(safeOAuthRedirect(target, registered)).toBe(false);
    expect(safeOAuthRedirect('http://127.0.0.1:5000/cb?code=x', 'http://127.0.0.1:5000/cb')).toBe(
      true,
    );
    expect(safeOAuthRedirect('http://evil.example/cb?code=x')).toBe(false);
  });

  it('only continues login on internal paths', () => {
    expect(safeNext('/oauth/consent?authorization_id=abc')).toContain('/oauth/consent');
    for (const target of ['//evil.test', '/\\evil.test', 'https://evil.test', '/\n/evil.test']) {
      expect(safeNext(target)).toBe('/dashboard');
    }
  });
});
