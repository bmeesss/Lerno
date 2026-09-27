import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static guard only; the migration must also be applied and verified against
// a disposable Supabase/Postgres instance before the feature is enabled.
const sql = readFileSync(
  new URL('../../../database/migrations/0006_profiles_role_privileges.sql', import.meta.url),
  'utf8',
);

describe('profile role cannot be self-promoted using an OAuth Bearer at PostgREST', () => {
  it('removes table-wide UPDATE/INSERT and only grants non-privileged columns', () => {
    expect(sql).toMatch(
      /revoke update, insert on table public\.profiles from public, anon, authenticated;/i,
    );
    const columns = sql.match(
      /grant update \(([^)]+)\)\s+on table public\.profiles to authenticated;/i,
    )?.[1];
    expect(columns).toBeDefined();
    expect(
      columns!
        .split(',')
        .map((column) => column.trim())
        .sort(),
    ).toEqual(['display_name', 'avatar_url', 'timezone', 'updated_at'].sort());
    expect(sql).toMatch(/drop policy if exists "profiles_insert_own"/i);
    expect(sql).toMatch(/create or replace function public\.is_admin\(\)/i);
    expect(sql).toMatch(/auth\.jwt\(\)\s*->>\s*'client_id'\s+is null/i);
  });
});
