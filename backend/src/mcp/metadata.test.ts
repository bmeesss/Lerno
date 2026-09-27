import request from 'supertest';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';

// A local configuration fixture; no Supabase or production host contacted.
vi.mock('../config.js', () => ({
  isSupabaseConfigured: true,
  config: {
    publicBackendUrl: 'https://mcp.test.invalid',
    supabaseUrl: 'https://auth.test.invalid',
    frontendUrls: [],
    nodeEnv: 'test',
  },
}));
import { wellKnownRoutes } from './metadata.js';
import { mcpRoutes } from './router.js';
const app = express();
app.use(express.json());
app.use('/.well-known', wellKnownRoutes());
app.use('/api/mcp', mcpRoutes());

describe('OAuth discovery with local issuer fixture', () => {
  it('advertises the path-specific MCP resource and Supabase Auth issuer', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource/api/mcp',
      '/.well-known/oauth-protected-resource',
    ]) {
      const res = await request(app).get(path).set('Host', 'attacker.invalid');
      expect(res.status).toBe(200);
      expect(res.body.resource).toBe('https://mcp.test.invalid/api/mcp');
      expect(res.body.authorization_servers).toEqual(['https://auth.test.invalid/auth/v1']);
    }
  });

  it('uses the fixed origin for the 401 challenge, not the Host header', async () => {
    const res = await request(app)
      .post('/api/mcp')
      .set('Host', 'attacker.invalid')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe(
      'Bearer resource_metadata="https://mcp.test.invalid/.well-known/oauth-protected-resource/api/mcp"',
    );
  });
});
