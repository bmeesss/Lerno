/** Dev-data-mode MCP fixture with mocked OAuth-shaped tokens. Resource/audience
 * enforcement in Supabase-backed mode is exercised separately in
 * mcp-resource.test.ts. No external provider or network I/O.
 */
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { memoryAddUser } from './lib/db/memory.js';
import { getMemoryState } from './lib/db/index.js';
import { createApp } from './app.js';

const { secret } = vi.hoisted(() => ({ secret: crypto.randomUUID() + crypto.randomUUID() }));
vi.mock('./lib/auth/index.js', () => ({
  getAuthProvider: () => ({
    verify: async (token: string) => {
      try {
        const claims = jwt.verify(token, secret, {
          algorithms: ['HS256'],
          audience: 'lerno-mcp-test',
        });
        if (typeof claims === 'string' || claims.typ !== 'oauth' || typeof claims.sub !== 'string')
          return null;
        return { id: claims.sub, email: String(claims.email), oauthClient: true };
      } catch {
        return null;
      }
    },
  }),
}));

const app = createApp();
function account(name: string, role: 'user' | 'admin' = 'user') {
  const id = randomUUID();
  const email = `${name}@test.invalid`;
  const createdAt = new Date().toISOString();
  memoryAddUser(
    getMemoryState(),
    { id, email, createdAt },
    {
      id,
      displayName: name,
      avatarUrl: null,
      role,
      timezone: 'UTC',
      createdAt,
      updatedAt: createdAt,
    },
  );
  const token = jwt.sign({ sub: id, email, typ: 'oauth', client_id: 'local-mcp-client' }, secret, {
    expiresIn: '15m',
    audience: 'lerno-mcp-test',
  });
  return { id, token };
}
const call = (token: string | null, name: string, args: Record<string, unknown> = {}) => {
  const req = request(app).post('/api/mcp').set('Accept', 'application/json, text/event-stream');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });
};
function result(res: request.Response): {
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
} {
  const line = res.text.split('\n').find((s) => s.startsWith('data: '));
  expect(line).toBeDefined();
  return (
    JSON.parse(line!.slice(6)) as {
      result: { structuredContent?: Record<string, unknown>; isError?: boolean };
    }
  ).result;
}

describe('MCP with locally mocked OAuth provider', () => {
  it('rejects missing, invalid and expired OAuth tokens before listing tools', async () => {
    const a = account('expired');
    const payload = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    const send = (token: string | null) => {
      const req = request(app)
        .post('/api/mcp')
        .set('Accept', 'application/json, text/event-stream');
      if (token) req.set('Authorization', `Bearer ${token}`);
      return req.send(payload);
    };
    expect((await send(null)).status).toBe(401);
    expect((await send('bad-token')).status).toBe(401);
    const expired = jwt.sign({ sub: a.id, typ: 'oauth' }, secret, {
      expiresIn: -1,
      audience: 'lerno-mcp-test',
    });
    expect((await send(expired)).status).toBe(401);
    expect((await send(a.token)).status).toBe(200);
  });

  it('binds create/read/update/delete to the verified OAuth subject, never the tool arguments', async () => {
    const a = account('oauth-a');
    const b = account('oauth-b');
    const created = result(
      await call(a.token, 'lerno_create_set', {
        title: 'Only A',
        visibility: 'public',
        cards: [{ question: 'Q?', answer: 'A' }],
        ownerId: b.id,
      }),
    );
    expect(created.isError).not.toBe(true);
    const setId = (created.structuredContent!.set as { id: string }).id;
    expect(
      (await request(app).get('/api/sets').set('Authorization', `Bearer ${a.token}`)).status,
    ).toBe(200);
    const bList = result(await call(b.token, 'lerno_list_sets'));
    expect(bList.structuredContent?.count).toBe(0);
    expect(result(await call(b.token, 'lerno_get_set', { setId })).isError).toBe(true);
    expect(
      result(await call(b.token, 'lerno_update_set', { setId, title: 'Stolen' })).isError,
    ).toBe(true);
    expect(
      result(await call(b.token, 'lerno_delete_set', { setId, confirmation: 'DELETE' })).isError,
    ).toBe(true);
    const afterDeniedWrites = result(await call(a.token, 'lerno_get_set', { setId }));
    expect(afterDeniedWrites.isError).not.toBe(true);
    expect((afterDeniedWrites.structuredContent?.set as { title: string }).title).toBe('Only A');
    // The existing REST public-set read remains available to B; MCP still denies it.
    expect(
      (await request(app).get(`/api/sets/${setId}`).set('Authorization', `Bearer ${b.token}`))
        .status,
    ).toBe(200);
    expect(
      result(await call(a.token, 'lerno_update_set', { setId, title: 'Updated' })).isError,
    ).not.toBe(true);
    expect(
      result(await call(a.token, 'lerno_delete_set', { setId, confirmation: 'DELETE' })).isError,
    ).not.toBe(true);
  });

  it('never grants service-role admin APIs to an OAuth client token', async () => {
    const admin = account('oauth-admin', 'admin');
    const res = await request(app)
      .get('/api/admin/metrics')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    // Learning tools remain bound to this user, with no admin privileges.
    expect(result(await call(admin.token, 'lerno_get_profile')).isError).not.toBe(true);
  });
});
