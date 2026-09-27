#!/usr/bin/env node
/* global fetch, AbortSignal, clearTimeout, setTimeout */
/* eslint no-console: off -- This is an interactive local CLI; output is redacted. */
/** Opt-in diagnostic client for an ISOLATED Supabase + Lerno staging stack.
 * No network by default. Never run against production; no secrets/tokens/codes
 * are written to disk or printed. Run on the same workstation as the browser:
 * the callback binds only to 127.0.0.1:53921 on that workstation.
 * See docs/MCP_OAUTH_ISOLATED_TEST.md before --run.
 */
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import process from 'node:process';
import { URL, URLSearchParams } from 'node:url';

const CALLBACK = 'http://127.0.0.1:53921/callback';
const PORT = 53921;
const CONFIRM = 'YES_ISOLATED_TEST_ONLY';
const [command = '--help', mode = 'resource', ...flags] = process.argv.slice(2);
const allowedModes = new Set(['resource', 'no-resource', 'other-resource']);

class ProbeError extends Error {}
function fail(message) {
  throw new ProbeError(message);
}
function origin(value, label) {
  if (!value) fail(`${label} is required`);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
    fail(`${label} must be a bare HTTPS origin without a trailing slash`);
  }
  return url.origin;
}
function settings() {
  const backend = origin(process.env.LERNO_TEST_BACKEND_ORIGIN, 'LERNO_TEST_BACKEND_ORIGIN');
  const frontend = origin(process.env.LERNO_TEST_FRONTEND_ORIGIN, 'LERNO_TEST_FRONTEND_ORIGIN');
  const supabase = origin(process.env.LERNO_TEST_SUPABASE_ORIGIN, 'LERNO_TEST_SUPABASE_ORIGIN');
  const clientId = process.env.LERNO_TEST_CLIENT_ID;
  if (!clientId || !/^[a-zA-Z0-9_-]{3,128}$/.test(clientId))
    fail('Set LERNO_TEST_CLIENT_ID to the registered public client ID');
  // These are safeguards, NOT proof that the project is isolated. Confirm it manually.
  const forbidden = new Set([
    'https://lerno-backend-c79j.onrender.com',
    'https://lerno.onrender.com',
  ]);
  if ([backend, frontend, supabase].some((value) => forbidden.has(value))) {
    fail('Known production origin forbidden');
  }
  if (!supabase.endsWith('.supabase.co') && !supabase.endsWith('.supabase.in')) {
    fail('Only a dedicated hosted Supabase test project is accepted');
  }
  if (new Set([backend, frontend, supabase]).size !== 3) fail('Use three separate origins');
  const resource = `${backend}/api/mcp`;
  const other =
    mode === 'other-resource'
      ? `${origin(process.env.LERNO_TEST_OTHER_BACKEND_ORIGIN, 'LERNO_TEST_OTHER_BACKEND_ORIGIN')}/api/mcp`
      : null;
  if (other === resource) fail('The other resource must differ from MCP');
  if (other && forbidden.has(other.slice(0, -'/api/mcp'.length))) {
    fail('Known production origin forbidden as other resource');
  }
  return { backend, frontend, supabase, clientId, resource, other, issuer: `${supabase}/auth/v1` };
}
function expectedUser(name) {
  const id = process.env[`LERNO_TEST_USER_${name}_ID`];
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    fail(`Set LERNO_TEST_USER_${name}_ID to the UUID of the disposable test account`);
  }
  return id;
}
function equalState(actual, expected) {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function json(url, init) {
  const res = await fetch(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) fail(`Preflight ${new URL(url).pathname} returned HTTP ${res.status}`);
  return res.json();
}
async function preflight(cfg) {
  const prm = await json(`${cfg.backend}/.well-known/oauth-protected-resource/api/mcp`);
  if (prm.resource !== cfg.resource || !prm.authorization_servers?.includes(cfg.issuer)) {
    fail('Protected-resource metadata does not match the configured test resource/issuer');
  }
  const meta = await json(`${cfg.supabase}/.well-known/oauth-authorization-server/auth/v1`);
  if (meta.issuer !== cfg.issuer) fail('Authorization-server issuer mismatch');
  const authorize = new URL(meta.authorization_endpoint);
  const token = new URL(meta.token_endpoint);
  if (
    authorize.origin !== cfg.supabase ||
    token.origin !== cfg.supabase ||
    authorize.pathname !== '/auth/v1/oauth/authorize' ||
    token.pathname !== '/auth/v1/oauth/token'
  ) {
    fail('Unexpected authorization/token endpoint: refusing to send a code to a different host');
  }
  if (
    meta.code_challenge_methods_supported &&
    !meta.code_challenge_methods_supported.includes('S256')
  ) {
    fail('Authorization server does not advertise PKCE S256');
  }
  return { authorize: authorize.href, token: token.href };
}
function callback(state, authorizationUrl) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', CALLBACK);
      if (req.method === 'GET' && url.pathname === '/start') {
        res
          .writeHead(302, {
            Location: authorizationUrl,
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          })
          .end();
        return;
      }
      const valid =
        req.method === 'GET' &&
        url.pathname === '/callback' &&
        url.searchParams.getAll('state').length === 1 &&
        equalState(url.searchParams.get('state'), state);
      if (!valid) {
        res.writeHead(400).end('Invalid callback/state');
        return;
      }
      if (url.searchParams.has('error')) {
        res.writeHead(400).end('Authorization denied or failed; return to terminal');
        clearTimeout(timeout);
        server.close();
        reject(new ProbeError('Authorization rejected by the test issuer'));
        return;
      }
      if (url.searchParams.getAll('code').length !== 1 || !url.searchParams.get('code')) {
        res.writeHead(400).end('Missing or duplicate code');
        return;
      }
      const code = url.searchParams.get('code');
      res
        .writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
        .end('Callback received. Return to terminal; no tokens are displayed here.');
      clearTimeout(timeout);
      server.close();
      resolve(code);
    });
    server.on('error', reject);
    const timeout = setTimeout(() => {
      server.close();
      reject(new ProbeError('Callback timed out after 5 minutes'));
    }, 300_000);
    server.listen(PORT, '127.0.0.1', () =>
      console.log(`Waiting on ${CALLBACK} (local browser only)`),
    );
  });
}
function claims(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) fail('Not a JWT');
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    fail('Expected a JWT access token');
  }
}
async function oauthRound(cfg, endpoints, label, expectedSub) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(32).toString('base64url');
  const requestedResource =
    mode === 'resource' ? cfg.resource : mode === 'other-resource' ? cfg.other : null;
  const url = new URL(endpoints.authorize);
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: CALLBACK,
    scope: 'email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }))
    url.searchParams.set(key, value);
  if (requestedResource) url.searchParams.set('resource', requestedResource);
  const pending = callback(state, url.href);
  console.log(
    `\n${label}: in your LOCAL browser log in to ${cfg.frontend}, then open http://127.0.0.1:${PORT}/start`,
  );
  console.log(
    'The local redirect keeps state and PKCE challenge out of the terminal. Use a different signed-in test user for B.',
  );
  const code = await pending; // state checked with timing-safe comparison; code never logged
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: cfg.clientId,
    redirect_uri: CALLBACK,
    code_verifier: verifier,
  });
  if (requestedResource) form.set('resource', requestedResource);
  const response = await fetch(endpoints.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    fail(`Token exchange failed (HTTP ${response.status}); no token or code logged`);
  const data = await response.json();
  if (typeof data.access_token !== 'string' || data.token_type?.toLowerCase() !== 'bearer')
    fail('No Bearer access token');
  const jwt = claims(data.access_token); // local inspection only, NOT authentication
  const aud = jwt.aud;
  const clientMatches = jwt.client_id === cfg.clientId;
  const issuerMatches = jwt.iss === cfg.issuer;
  const resourceMatches =
    aud === cfg.resource || (Array.isArray(aud) && aud.length === 1 && aud[0] === cfg.resource);
  console.log(
    `${label} token evidence (no token printed):`,
    JSON.stringify({
      aud: resourceMatches
        ? cfg.resource
        : aud === cfg.other || aud === 'authenticated'
          ? aud
          : '[unexpected audience redacted]',
      client_id_matches: clientMatches,
      issuer_matches: issuerMatches,
      expected_sub_matches: jwt.sub === expectedSub,
      exp: jwt.exp ? new Date(jwt.exp * 1000).toISOString() : null,
    }),
  );
  if (!clientMatches || !issuerMatches || jwt.sub !== expectedSub || typeof jwt.exp !== 'number') {
    fail('Required issuer/client/expected subject/expiry claim missing or mismatched');
  }
  // A requested MCP resource with a generic/wrong audience is an issuer failure.
  // Never send that Bearer to MCP; use the explicit negative-control modes to
  // prove Lerno returns 401 for tokens intentionally issued for other targets.
  if (mode === 'resource' && !resourceMatches) {
    fail('Issuer did not bind the requested resource to aud; stopping before MCP. No workaround.');
  }
  return { bearer: data.access_token, sub: jwt.sub, exp: jwt.exp, aud, resourceMatches };
}
async function api(cfg, bearer, path, body) {
  const response = await fetch(`${cfg.backend}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${bearer}`,
      ...(body
        ? {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 200 && body) {
    const text = await response.text();
    const data = text.split('\n').find((line) => line.startsWith('data: '));
    if (!data) fail('MCP returned HTTP 200 without a JSON-RPC SSE result');
    return { status: response.status, rpc: JSON.parse(data.slice(6)) };
  }
  return { status: response.status };
}
const rpc = (name, args = {}) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name, arguments: args },
});
function tool(response) {
  if (response.status !== 200 || !response.rpc?.result)
    fail(`MCP tools/call failed (HTTP ${response.status})`);
  return response.rpc.result;
}
async function run() {
  if (command === '--help') {
    console.log(
      'Usage: node scripts/oauth-isolated-probe.mjs --prepare | --run [resource|no-resource|other-resource] [--second-user] [--admin-user] [--wait-expiry]',
    );
    console.log('See docs/MCP_OAUTH_ISOLATED_TEST.md. Default: no requests.');
    return;
  }
  if (!['--prepare', '--run'].includes(command) || !allowedModes.has(mode))
    fail('Invalid command/mode');
  if (
    flags.some((flag) => !['--second-user', '--admin-user', '--wait-expiry'].includes(flag)) ||
    (mode !== 'resource' && flags.length > 0) ||
    (flags.includes('--wait-expiry') && flags.length > 1)
  ) {
    fail(
      'Unsupported flag combination; run expiry, A/B and admin as separate resource-mode probes',
    );
  }
  const cfg = settings();
  console.log('Isolated test identifiers:', {
    issuer: cfg.issuer,
    resource: cfg.resource,
    redirect_uri: CALLBACK,
    scope: 'email',
  });
  if (command === '--prepare') {
    console.log('No network requests made.');
    return;
  }
  if (process.env.LERNO_TEST_CONFIRM_ISOLATED !== CONFIRM)
    fail(
      `Set LERNO_TEST_CONFIRM_ISOLATED=${CONFIRM} only after verifying every origin belongs to a disposable test project.`,
    );
  const userA = expectedUser('A');
  const userB = flags.includes('--second-user') ? expectedUser('B') : null;
  const adminUser = flags.includes('--admin-user') ? expectedUser('ADMIN') : null;
  const endpoints = await preflight(cfg);
  const a = await oauthRound(cfg, endpoints, 'Test user A', userA);
  const first = await api(cfg, a.bearer, '/api/mcp', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  });
  if (mode !== 'resource') {
    if (first.status !== 401)
      fail(`FAIL: ${mode} token unexpectedly reached MCP (HTTP ${first.status})`);
    console.log(`PASS: ${mode} token rejected by MCP with 401.`);
    if (mode === 'no-resource' && a.aud !== 'authenticated')
      fail('No-resource token is not the expected authenticated control');
    if (mode === 'other-resource' && a.aud !== cfg.other)
      fail(
        'Issuer did not bind the other resource to aud; this is NOT evidence of RFC 8707 support',
      );
    return;
  }
  if (first.status !== 200)
    fail(
      `Issuer did not produce a usable MCP token (MCP HTTP ${first.status}); stop. No workaround.`,
    );
  if (!Array.isArray(first.rpc?.result?.tools)) fail('MCP tools/list response malformed');
  console.log('PASS: exact MCP audience -> 200 and tool listing.');
  if (flags.includes('--wait-expiry')) {
    const remaining = a.exp * 1000 - Date.now() + 2000;
    if (remaining > 300_000)
      fail('Set a short access token lifetime in isolated staging (<=5 min) before expiry test');
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    if (
      (await api(cfg, a.bearer, '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }))
        .status !== 401
    )
      fail('FAIL: expired token was accepted');
    console.log('PASS: expired token -> 401.');
    return;
  }
  if (flags.includes('--second-user')) {
    const created = tool(
      await api(
        cfg,
        a.bearer,
        '/api/mcp',
        rpc('lerno_create_set', { title: 'Isolated OAuth probe', visibility: 'private' }),
      ),
    );
    if (created.isError || typeof created.structuredContent?.set?.id !== 'string')
      fail('Could not create A private set');
    const setId = created.structuredContent.set.id;
    try {
      const b = await oauthRound(cfg, endpoints, 'Test user B (different account)', userB);
      if (a.sub === b.sub || !b.resourceMatches)
        fail('B must be a different user with the correct resource audience');
      for (const [name, args] of [
        ['lerno_get_set', { setId }],
        ['lerno_update_set', { setId, title: 'Unauthorized change' }],
        ['lerno_delete_set', { setId, confirmation: 'DELETE' }],
      ]) {
        const result = tool(await api(cfg, b.bearer, '/api/mcp', rpc(name, args)));
        if (!result.isError || !result.content?.[0]?.text?.startsWith('[NOT_FOUND]'))
          fail(`FAIL: B accessed A set with ${name}`);
      }
      console.log('PASS: B cannot read, update or delete A private set.');
    } finally {
      const cleanup = tool(
        await api(
          cfg,
          a.bearer,
          '/api/mcp',
          rpc('lerno_delete_set', { setId, confirmation: 'DELETE' }),
        ),
      );
      if (cleanup.isError) console.error('Warning: delete the isolated probe set manually');
    }
  }
  if (flags.includes('--admin-user')) {
    const admin = await oauthRound(cfg, endpoints, 'Disposable admin user', adminUser);
    if (!admin.resourceMatches) fail('Admin OAuth token has the wrong resource audience');
    const me = await fetch(`${cfg.backend}/api/auth/me`, {
      headers: { Authorization: `Bearer ${admin.bearer}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    if (me.status !== 200) fail('Cannot verify admin account via /api/auth/me');
    const own = await me.json();
    if (own?.data?.id !== admin.sub || own?.data?.profile?.role !== 'admin') {
      fail(
        'Use a disposable admin test account; an ordinary user 403 proves nothing about admin isolation',
      );
    }
    const response = await api(cfg, admin.bearer, '/api/admin/metrics');
    if (response.status !== 403) fail(`FAIL: OAuth admin token received HTTP ${response.status}`);
    console.log(
      'PASS: verified admin account OAuth token denied admin API. Verify normal website admin session still succeeds separately.',
    );
  }
  console.log('No tokens, refresh tokens, codes or verifier written to disk.');
}
run().catch((error) => {
  // Unexpected runtime/provider errors may contain URLs or response details.
  // Never print those: authorization codes, state and tokens must stay local.
  console.error(
    error instanceof ProbeError
      ? `Probe stopped: ${error.message}`
      : 'Probe stopped: unexpected error (details redacted)',
  );
  process.exitCode = 1;
});
