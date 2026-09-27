/** MCP's resource-server check (MCP Authorization / RFC 8707).
 * Supabase Auth must have cryptographically validated the *same* bearer first
 * and issued an audience bound to the OAuth `resource` parameter. Lerno never
 * signs or invents a resource claim. A normal website token with Supabase's
 * generic `authenticated` audience is NOT an MCP access token.
 */
import { isSupabaseConfigured } from '../config.js';
import type { AuthContext } from '../types/express.js';
import { backendOrigin, MCP_PATH } from './metadata.js';

export function mayUseMcp(auth: AuthContext | undefined): boolean {
  if (!auth) return false;
  // Explicitly preserve direct Bearer tests ONLY in local in-memory mode.
  // Production cannot run in that mode (config.ts fails fast).
  if (!isSupabaseConfigured) return true;

  const expected = `${backendOrigin()}${MCP_PATH}`;
  const aud = auth.audience;
  // JWT audiences may be strings or arrays. Require exactly this resource,
  // not an issuer-wide audience or a multi-resource token.
  return (
    auth.oauthClient === true &&
    (aud === expected || (Array.isArray(aud) && aud.length === 1 && aud[0] === expected))
  );
}
