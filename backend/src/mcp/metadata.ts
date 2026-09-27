/** OAuth protected-resource discovery (RFC 9728 / MCP authorization).
 * Supabase Auth is the authorization server; Lerno never receives client
 * secrets, authorization codes or refresh tokens from MCP clients.
 */
import type { Request, Response } from 'express';
import { Router } from 'express';
import { config, isSupabaseConfigured } from '../config.js';

export const MCP_PATH = '/api/mcp';
export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource/api/mcp';

export function authorizationServerIssuer(): string | null {
  if (!isSupabaseConfigured) return null;
  return `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1`;
}

/** Never reflect Host, X-Forwarded-Host or X-Forwarded-Proto into discovery.
 * Dev data mode has no OAuth issuer; its stable localhost origin is only for
 * local CLI tests. Supabase-backed environments require PUBLIC_BACKEND_URL. */
export function backendOrigin(): string {
  if (config.publicBackendUrl) return new URL(config.publicBackendUrl).origin;
  return `http://localhost:${config.port}`;
}

export function resourceMetadataUrl(origin: string): string {
  return `${origin}${PROTECTED_RESOURCE_PATH}`;
}

export function protectedResourceMetadata(origin: string) {
  const issuer = authorizationServerIssuer();
  return {
    resource: `${origin}${MCP_PATH}`,
    resource_name: 'Lerno MCP',
    authorization_servers: issuer ? [issuer] : [],
    // OAuth scopes are identity claims, not fine-grained tool permissions.
    scopes_supported: ['openid', 'profile', 'email'],
    bearer_methods_supported: ['header'],
  };
}

export function wellKnownRoutes(): Router {
  const router = Router();
  const respond = (_req: Request, res: Response) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(protectedResourceMetadata(backendOrigin()));
  };
  router.get('/oauth-protected-resource/api/mcp', respond);
  // Root fallback for clients that only probe the origin-level location.
  router.get('/oauth-protected-resource', respond);
  return router;
}

export function sendMcpUnauthorized(res: Response, origin: string): void {
  res
    .status(401)
    .set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl(origin)}"`)
    .json({ error: { code: 'UNAUTHORIZED', message: 'You must be logged in to use Lerno MCP' } });
}
