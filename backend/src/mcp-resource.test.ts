/** Local resource-server integration fixture. Mock Supabase verifies the JWT
 * cryptographically but does NOT enforce resource audience: that is precisely
 * Lerno's responsibility after verification. No network/production calls.
 */
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { memoryAddUser } from './lib/db/memory.js';
import { getMemoryState } from './lib/db/index.js';
import { createApp } from './app.js';

const { secret } = vi.hoisted(() => ({ secret: crypto.randomUUID() + crypto.randomUUID() }));
const RESOURCE = 'https://mcp.test.invalid/api/mcp';
vi.mock('./config.js', () => ({
  isSupabaseConfigured: true,
  config: {
    publicBackendUrl: 'https://mcp.test.invalid',
    supabaseUrl: 'https://auth.test.invalid',
    supabaseAnonKey: 'local-public-key',
    frontendUrls: [],
    isTest: true,
    nodeEnv: 'test',
  },
}));
vi.mock('./lib/db/index.js', async () => {
  const { createMemoryState, createMemoryDatabase } = await import('./lib/db/memory.js');
  const state = createMemoryState();
  return {
    getMemoryState: () => state,
    createDatabase: () => createMemoryDatabase(state),
    createAdminDatabase: () => createMemoryDatabase(state),
  };
});
vi.mock('./lib/auth/index.js', () => ({
  getAuthProvider: () => ({
    verify: async (token: string) => {
      try {
        const claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
        if (typeof claims === 'string' || claims.typ !== 'access' || typeof claims.sub !== 'string')
          return null;
        return {
          id: claims.sub,
          email: String(claims.email),
          oauthClient: typeof claims.client_id === 'string',
          audience: claims.aud,
        };
      } catch {
        return null;
      }
    },
  }),
}));

const app = createApp();
function account(role: 'admin' | 'user' = 'user') {
  const id = randomUUID();
  const email = `${id}@test.invalid`;
  const createdAt = new Date().toISOString();
  memoryAddUser(
    getMemoryState(),
    { id, email, createdAt },
    {
      id,
      displayName: 'Local fixture',
      role,
      avatarUrl: null,
      timezone: 'UTC',
      createdAt,
      updatedAt: createdAt,
    },
  );
  return { id, email };
}
function token(
  id: string,
  email: string,
  aud?: string | string[],
  clientId?: string,
  expiresIn: string | number = '15m',
) {
  return jwt.sign(
    { sub: id, email, typ: 'access', ...(clientId ? { client_id: clientId } : {}) },
    secret,
    { ...(aud ? { audience: aud } : {}), expiresIn: expiresIn as jwt.SignOptions['expiresIn'] },
  );
}
const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
function mcp(bearer?: string) {
  const req = request(app).post('/api/mcp').set('Accept', 'application/json, text/event-stream');
  if (bearer) req.set('Authorization', `Bearer ${bearer}`);
  return req.send(body);
}

describe('Supabase-backed MCP OAuth resource audience', () => {
  it('accepts only a verified OAuth token for exactly the published MCP resource', async () => {
    const user = account();
    const valid = token(user.id, user.email, RESOURCE, 'registered-mcp-client');
    const response = await mcp(valid);
    expect(response.status).toBe(200);
    expect(response.text).toContain('lerno_list_sets');
    const metadata = await request(app).get('/.well-known/oauth-protected-resource/api/mcp');
    expect(metadata.body.resource).toBe(RESOURCE);
  });

  it('rejects other-resource, issuer-wide and missing audiences even for valid signed account tokens', async () => {
    const user = account();
    for (const aud of [
      'https://other.test.invalid/api/mcp',
      'authenticated',
      undefined,
      [RESOURCE, 'https://other.test.invalid/api/mcp'],
      'https://mcp.test.invalid',
    ]) {
      const response = await mcp(token(user.id, user.email, aud, 'registered-mcp-client'));
      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBe(
        'Bearer resource_metadata="https://mcp.test.invalid/.well-known/oauth-protected-resource/api/mcp"',
      );
    }
    expect((await mcp(token(user.id, user.email, RESOURCE))).status).toBe(401);
  });

  it('rejects expired, tampered and absent tokens before tool handling', async () => {
    const user = account();
    const expired = token(user.id, user.email, RESOURCE, 'registered-mcp-client', -1);
    const valid = token(user.id, user.email, RESOURCE, 'registered-mcp-client');
    expect((await mcp(expired)).status).toBe(401);
    expect((await mcp(`${valid}tampered`)).status).toBe(401);
    expect((await mcp()).status).toBe(401);
  });

  it('preserves normal website REST/admin sessions, but gives OAuth admin tokens no admin access', async () => {
    const admin = account('admin');
    const website = token(admin.id, admin.email, 'authenticated');
    expect((await mcp(website)).status).toBe(401);
    expect(
      (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${website}`)).status,
    ).toBe(200);
    expect(
      (await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${website}`))
        .status,
    ).toBe(200);
    const oauth = token(admin.id, admin.email, RESOURCE, 'registered-mcp-client');
    expect((await mcp(oauth)).status).toBe(200);
    expect(
      (await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${oauth}`)).status,
    ).toBe(403);
  });
});
