/** A return-to path is never an external redirect (including //host paths).
 * OAuth state is generated/checked by the MCP client and its authorization
 * request is held by Supabase; only the opaque authorization_id crosses login.
 */
export function safeNext(value: string | null): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\') ||
    [...value].some((char) => char === '\\' || char.charCodeAt(0) < 32)
  )
    return '/dashboard';
  return value;
}
