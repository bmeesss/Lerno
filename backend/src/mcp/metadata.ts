/**
 * OAuth discovery for the Lerno MCP resource server (Phase 7.5).
 *
 * Lerno is an OAuth *resource server*: Supabase Auth acts as the OAuth 2.1
 * authorization server (authorize/token/discovery/dynamic registration all
 * live there), while this module publishes the RFC 9728 protected-resource
 * metadata that MCP clients use to find it:
 *
 *   401 + WWW-Authenticate (resource_metadata pointer)
 *     → GET /.well-known/oauth-protected-resource
 *       → authorization_servers: [<supabase-issuer>]
 *         → <issuer>/.well-known/oauth-authorization-server/… (on Supabase)
 *
 * In development data mode there is no authorization server, so the metadata
 * advertises an empty issuer list and direct bearer tokens remain the way to
 * authenticate (see docs/mcp.md).
 */
import type { Request, Response } from 'express';
import { Router } from 'express';
import { config, isSupabaseConfigured } from '../config.js';

export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

/** Supabase Auth issuer: the OAuth 2.1 authorization server for Lerno MCP. */
export function authorizationServerIssuer(): string | null {
  if (!isSupabaseConfigured) return null;
  return `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1`;
}

/**
 * Canonical backend origin. Explicit PUBLIC_BACKEND_URL wins; otherwise the
 * origin is derived from proxy-aware request headers (Render terminates TLS
 * in front of the app, so X-Forwarded-Proto is honored).
 */
export function backendOrigin(req: Request): string {
  if (config.publicBackendUrl) return config.publicBackendUrl.replace(/\/$/, '');
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto =
    (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto?.split(',')[0]?.trim()) ||
    req.protocol ||
    'http';
  const forwardedHost = req.headers['x-forwarded-host'];
  const host =
    (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? req.headers.host;
  return `${proto}://${host}`;
}

export function resourceMetadataUrl(origin: string): string {
  return `${origin}${PROTECTED_RESOURCE_PATH}`;
}

export interface ProtectedResourceMetadata {
  resource: string;
  resource_name: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
}

/**
 * RFC 9728 metadata. Scopes are the standard Supabase-supported ones; v1
 * tools authorize on identity only (documented in docs/mcp.md).
 */
export function protectedResourceMetadata(origin: string): ProtectedResourceMetadata {
  const issuer = authorizationServerIssuer();
  return {
    resource: origin,
    resource_name: 'Lerno MCP',
    authorization_servers: issuer ? [issuer] : [],
    scopes_supported: ['openid', 'profile', 'email'],
    bearer_methods_supported: ['header'],
  };
}

export function wellKnownRoutes(): Router {
  const router = Router();
  router.get('/oauth-protected-resource', (req: Request, res: Response) => {
    res.json(protectedResourceMetadata(backendOrigin(req)));
  });
  return router;
}

/**
 * 401 for unauthenticated MCP requests: the standard error envelope plus the
 * RFC 9728 WWW-Authenticate challenge real MCP clients bootstrap from.
 */
export function sendMcpUnauthorized(res: Response, origin: string): void {
  res
    .status(401)
    .set(
      'WWW-Authenticate',
      `Bearer resource_metadata="${resourceMetadataUrl(origin)}"`,
    )
    .json({ error: { code: 'UNAUTHORIZED', message: 'You must be logged in to use Lerno MCP' } });
}
