/**
 * Phase 7.5 coverage: OAuth discovery, Bearer authentication and MCP
 * transport compatibility for real remote clients.
 *
 * The authorization server itself is Supabase Auth (see docs/mcp.md), so
 * these tests cover Lerno's resource-server side: protected-resource
 * metadata, the 401 discovery challenge, token validation and transport
 * behavior — all through the real Express app.
 */
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { devJwtSecret } from './config.js';

const app = createApp();
const ACCEPT = 'application/json, text/event-stream';

async function signup(name: string): Promise<{ token: string; userId: string }> {
  const email = `${name.replace(/[^a-z]/gi, '')}${Date.now()}${Math.floor(
    Math.random() * 1e6,
  )}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: name });
  expect(res.status).toBe(201);
  return {
    token: res.body.data.accessToken as string,
    userId: res.body.data.user.id as string,
  };
}

async function mcp(
  token: string | null,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<request.Response> {
  const req = request(app).post('/api/mcp').send(body);
  for (const [key, value] of Object.entries({ Accept: ACCEPT, ...headers })) {
    req.set(key, value);
  }
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
}

function sseData(res: request.Response): Record<string, unknown> {
  const line = res.text
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('data: '));
  expect(line).toBeDefined();
  return JSON.parse(line!.slice('data: '.length)) as Record<string, unknown>;
}

function expiredToken(userId: string): string {
  return jwt.sign({ sub: userId, email: 'expired@example.com', typ: 'access' }, devJwtSecret(), {
    expiresIn: '-1h',
  });
}

describe('mcp oauth: discovery metadata', () => {
  it('serves RFC 9728 protected-resource metadata without authentication', async () => {
    const res = await request(app).get('/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.resource).toMatch(/^https?:\/\/.+\/api\/mcp$/);
    expect(res.body.resource_name).toBe('Lerno MCP');
    expect(Array.isArray(res.body.authorization_servers)).toBe(true);
    expect(res.body.scopes_supported).toEqual(['openid', 'profile', 'email']);
    expect(res.body.bearer_methods_supported).toEqual(['header']);
    // Test/dev mode has no authorization server; production points at Supabase.
    expect(res.body.authorization_servers).toEqual([]);
  });

  it('never reflects Host or proxy headers, even in local data mode', async () => {
    const res = await request(app)
      .get('/.well-known/oauth-protected-resource/api/mcp')
      .set('Host', 'attacker.invalid')
      .set('X-Forwarded-Proto', 'https')
      .set('X-Forwarded-Host', 'spoofed.invalid');
    expect(res.body.resource).toBe('http://localhost:4000/api/mcp');
    const challenge = await request(app)
      .post('/api/mcp')
      .set('Host', 'attacker.invalid')
      .set('X-Forwarded-Proto', 'https')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(challenge.headers['www-authenticate']).toBe(
      'Bearer resource_metadata="http://localhost:4000/.well-known/oauth-protected-resource/api/mcp"',
    );
  });

  it('tolerates garbage tokens on the public metadata endpoint', async () => {
    const res = await request(app)
      .get('/.well-known/oauth-protected-resource')
      .set('Authorization', 'Bearer bogus');
    expect(res.status).toBe(200);
  });
});

describe('mcp oauth: bearer authentication', () => {
  it('challenges unauthenticated requests with RFC 9728 discovery info', async () => {
    const res = await mcp(null, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body).not.toHaveProperty('data');
    const challenge = res.headers['www-authenticate'] as string;
    expect(challenge).toMatch(
      /^Bearer resource_metadata="https?:\/\/.+\/.well-known\/oauth-protected-resource\/api\/mcp"$/,
    );
  });

  it('rejects invalid and expired tokens the same way', async () => {
    const { userId } = await signup('McpOAuthExpired');
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

    const invalid = await mcp('not-a-token', body);
    expect(invalid.status).toBe(401);
    expect(invalid.headers['www-authenticate']).toContain('resource_metadata=');

    const expired = await mcp(expiredToken(userId), body);
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('UNAUTHORIZED');
    expect(expired.headers['www-authenticate']).toContain('resource_metadata=');
  });

  it('maps each valid token to its own user', async () => {
    const a = await signup('McpOAuthMapA');
    const b = await signup('McpOAuthMapB');
    const body = (name: string, args: Record<string, unknown> = {}) => ({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    });

    const profileA = sseData(await mcp(a.token, body('lerno_get_profile')));
    const resultA = profileA['result'] as { structuredContent: { profile: { id: string } } };
    expect(resultA.structuredContent.profile.id).toBe(a.userId);

    const profileB = sseData(await mcp(b.token, body('lerno_get_profile')));
    const resultB = profileB['result'] as { structuredContent: { profile: { id: string } } };
    expect(resultB.structuredContent.profile.id).toBe(b.userId);
  });

  it('ignores forged identity fields in tool arguments', async () => {
    const a = await signup('McpOAuthForgeA');
    const b = await signup('McpOAuthForgeB');
    const created = await request(app)
      .post('/api/sets')
      .set('Authorization', `Bearer ${b.token}`)
      .send({
        title: 'B secret',
        visibility: 'private',
        cards: [{ question: 'Q?', answer: 'A' }],
      });
    const setId = created.body.data.id as string;

    // A claims to be B via every plausible identity field; the token still wins.
    const res = await mcp(a.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'lerno_get_cards',
        arguments: { setId, userId: b.userId, user_id: b.userId, email: 'b@example.com' },
      },
    });
    const payload = sseData(res);
    const result = payload['result'] as { content: { text: string }[]; isError: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/^\[NOT_FOUND\]/);
  });
});

describe('mcp oauth: cross-user isolation over the wire', () => {
  it('enforces private/public visibility per token', async () => {
    const a = await signup('McpOAuthIsoA');
    const b = await signup('McpOAuthIsoB');
    const authA = { Authorization: `Bearer ${a.token}` };
    const authB = { Authorization: `Bearer ${b.token}` };
    const priv = (
      await request(app)
        .post('/api/sets')
        .set(authA)
        .send({
          title: 'Iso private',
          visibility: 'private',
          cards: [{ question: 'Q?', answer: 'A' }],
        })
    ).body.data.id as string;
    const pub = (
      await request(app)
        .post('/api/sets')
        .set(authB)
        .send({
          title: 'Iso public',
          visibility: 'public',
          cards: [{ question: 'Q?', answer: 'A' }],
        })
    ).body.data.id as string;

    const getSet = (setId: string) => ({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'lerno_get_set', arguments: { setId } },
    });
    const textOf = async (token: string, setId: string): Promise<string> => {
      const payload = sseData(await mcp(token, getSet(setId)));
      const result = payload['result'] as { content: { text: string }[] };
      return result.content[0]!.text;
    };

    expect(await textOf(a.token, priv)).toContain('Iso private');
    expect(await textOf(b.token, priv)).toMatch(/^\[NOT_FOUND\]/);
    expect(await textOf(a.token, pub)).toMatch(/^\[NOT_FOUND\]/);
    expect(await textOf(b.token, pub)).toContain('Iso public');
  });
});

describe('mcp oauth: transport compatibility', () => {
  it('wraps tool results in a single SSE message', async () => {
    const { token } = await signup('McpOAuthSse');
    const res = await mcp(token, { jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toMatch(/^event: message\ndata: /m);
    const payload = sseData(res);
    expect(payload['id']).toBe(7);
    expect((payload['result'] as { tools: unknown[] }).tools).toHaveLength(20);
  });

  it('requires the Streamable HTTP Accept header (SDK behavior)', async () => {
    const { token } = await signup('McpOAuthAccept');
    const res = await mcp(
      token,
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      { Accept: 'application/json' },
    );
    expect(res.status).toBe(406);
    expect(res.body.error.message).toMatch(/Accept/i);
  });

  it('answers preflight for allowlisted origins', async () => {
    const res = await request(app)
      .options('/api/mcp')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization, content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-headers']).toMatch(/authorization/i);
  });

  it('rejects non-JSON bodies and malformed JSON-RPC without leaking internals', async () => {
    const { token } = await signup('McpOAuthMalformed');

    // Wrong media type: the SDK answers 415 with a JSON-RPC error (spec behavior).
    const plain = await request(app)
      .post('/api/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', ACCEPT)
      .set('Content-Type', 'text/plain')
      .send('not json');
    expect(plain.status).toBe(415);
    expect(plain.body.error).toBeDefined();
    expect(JSON.stringify(plain.body)).not.toMatch(/stack|\.ts:|node_modules/i);

    // JSON primitive instead of a JSON-RPC object: standard 400 envelope.
    const primitive = await request(app)
      .post('/api/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', ACCEPT)
      .set('Content-Type', 'application/json')
      .send('null');
    expect(primitive.status).toBe(400);
    expect(primitive.body.error.code).toBe('VALIDATION_ERROR');

    const empty = sseData(
      await mcp(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }),
    );
    expect(empty['error']).toBeDefined();
    expect(JSON.stringify(empty)).not.toMatch(/stack|\.ts:|node_modules|Bearer /i);
  });

  it('keeps the REST API working (regression)', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
    const me = await request(app).get('/api/auth/me');
    expect(me.status).toBe(401);
    const { token } = await signup('McpOAuthRest');
    const authed = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(authed.status).toBe(200);
  });
});
