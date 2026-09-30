import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static guard for migration 0011. The in-memory database the other tests use cannot notice a
// migration that drifts from the Supabase repository, so this reads both files as text.
//
// The migration was also applied, in order after 0001-0010, to a real Postgres engine and its
// row-level security was exercised with two students; re-run that check against a disposable
// Supabase/Postgres instance before enabling the feature on production data.
const sql = readFileSync(
  new URL('../../../../database/migrations/0011_learning_sessions.sql', import.meta.url),
  'utf8',
);
const supabase = readFileSync(new URL('./supabase.ts', import.meta.url), 'utf8');

/** The migration without its comments, so a word in a comment never counts as a statement. */
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

/** The migration split into statements. */
const statements = code
  .split(/;\s*\n/)
  .map((statement) => statement.trim())
  .filter(Boolean);

/** The full text of one `create policy` statement. */
const policy = (name: string) =>
  statements.find((statement) => statement.startsWith(`create policy "${name}"`)) ?? '';

const NEW_TABLES = ['learning_sessions', 'learning_session_items', 'mastery_snapshots'] as const;

/** Column names of a `create table` block (column lines are indented by exactly two spaces). */
function tableColumns(table: string): string[] {
  const block = code.match(
    new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`),
  )?.[1];
  expect(block, `create table for ${table}`).toBeDefined();
  return block!
    .split('\n')
    .map((line) => line.match(/^ {2}([a-z_]+)\s/)?.[1])
    .filter((name): name is string => Boolean(name))
    .filter((name) => !['unique', 'primary', 'check', 'constraint', 'foreign'].includes(name));
}

/** Everything between two markers in supabase.ts. */
function section(from: string, to: string): string {
  const start = supabase.indexOf(from);
  const end = supabase.indexOf(to, start + from.length);
  expect(start, from).toBeGreaterThanOrEqual(0);
  expect(end, to).toBeGreaterThan(start);
  return supabase.slice(start, end);
}

describe('migration 0011 is additive', () => {
  it('creates exactly the three new tables, each with "if not exists"', () => {
    const created = [...code.matchAll(/create table\s+(if not exists\s+)?public\.(\w+)/gi)];
    expect(created.map((match) => match[2])).toEqual([...NEW_TABLES]);
    expect(created.every((match) => Boolean(match[1]))).toBe(true);
  });

  it('never drops, deletes, truncates or rewrites existing data', () => {
    expect(code).not.toMatch(/\bdrop\s+(table|column|index|schema|type|function|trigger)\b/i);
    expect(code).not.toMatch(/\b(truncate|delete\s+from)\b/i);
    expect(code).not.toMatch(/\bupdate\s+public\./i);
    expect(code).not.toMatch(/\binsert\s+into\b/i);
  });

  it('only alters its own tables (row-level security), never an existing one', () => {
    const altered = [...code.matchAll(/alter table\s+(?:only\s+)?([\w.]+)/gi)].map((m) => m[1]);
    expect(altered.length).toBeGreaterThan(0);
    for (const table of altered) {
      expect(NEW_TABLES.map((name) => `public.${name}`)).toContain(table);
    }
  });

  it('leaves the classic flashcard timer table study_sessions alone', () => {
    expect(code).not.toMatch(/public\.study_sessions\b/);
  });

  it('can be run twice: indexes use "if not exists" and every policy is dropped first', () => {
    const indexes = [...code.matchAll(/create\s+(?:unique\s+)?index\s+(if not exists\s+)?/gi)];
    expect(indexes.length).toBeGreaterThan(0);
    expect(indexes.every((match) => Boolean(match[1]))).toBe(true);

    const policies = [...code.matchAll(/create policy "([^"]+)" on (public\.\w+)/g)];
    expect(policies.length).toBe(NEW_TABLES.length * 2);
    for (const [, name, table] of policies) {
      expect(code).toContain(`drop policy if exists "${name}" on ${table};`);
    }
  });
});

describe('migration 0011 keeps study data private to each student', () => {
  it.each(NEW_TABLES)('%s has row-level security and own-row policies', (table) => {
    expect(statements).toContain(`alter table public.${table} enable row level security`);
    expect(policy(`${table}_own_select`)).toMatch(/for select using \(user_id = auth\.uid\(\)\)$/);
    expect(policy(`${table}_own_write`)).toMatch(
      /for all using \(user_id = auth\.uid\(\)\)\s+with check \(\s*user_id = auth\.uid\(\)/,
    );
  });

  it('only lets a student write a session or snapshot for a pack they can see', () => {
    for (const table of ['learning_sessions', 'mastery_snapshots']) {
      expect(policy(`${table}_own_write`)).toMatch(
        /p\.visibility = 'public' or p\.owner_id = auth\.uid\(\)/,
      );
    }
  });

  it('only lets a student add items to a session that is theirs', () => {
    expect(policy('learning_session_items_own_write')).toMatch(
      /from public\.learning_sessions s\s+where s\.id = learning_session_items\.session_id and s\.user_id = auth\.uid\(\)/,
    );
  });
});

describe('migration 0011 matches the Supabase repository', () => {
  const mappers = {
    learning_sessions: 'function learningSessionRow',
    learning_session_items: 'function learningSessionItemRow',
    mastery_snapshots: 'function masterySnapshotRow',
  } as const;

  it.each(NEW_TABLES)('the row mapper for %s reads exactly the columns the table has', (table) => {
    const start = supabase.indexOf(mappers[table]);
    expect(start).toBeGreaterThanOrEqual(0);
    const mapper = supabase.slice(start, supabase.indexOf('\n}\n', start));
    const read = new Set([
      ...[...mapper.matchAll(/\(row, '([a-z_]+)'\)/g)].map((match) => match[1]!),
      ...[...mapper.matchAll(/\brow\.([a-z_]+)(?![A-Za-z0-9])/g)].map((match) => match[1]!),
    ]);
    expect([...read].sort()).toEqual([...tableColumns(table)].sort());
  });

  it('every column the repository writes exists in its table', () => {
    const repos = {
      learning_sessions: section('learningSessions: {', 'learningSessionItems: {'),
      learning_session_items: section('learningSessionItems: {', 'masterySnapshots: {'),
      mastery_snapshots: section(
        'masterySnapshots: {',
        '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
      ),
    } as const;
    for (const table of NEW_TABLES) {
      const columns = new Set(tableColumns(table));
      const written = [
        ...repos[table].matchAll(/^\s+([a-z]+(?:_[a-z]+)+):\s/gm),
        ...repos[table].matchAll(/payload\.([a-z_]+) =/g),
      ].map((match) => match[1]!);
      expect(written.length, `${table}: something is written`).toBeGreaterThan(0);
      expect(
        written.filter((name) => !columns.has(name)),
        `${table}: columns written but not in the migration`,
      ).toEqual([]);
    }
  });

  it('upserts on a key the migration makes unique', () => {
    expect(supabase).toContain("onConflict: 'user_id,pack_id,day'");
    expect(code).toMatch(/unique \(user_id, pack_id, day\)/);
    expect(code).toMatch(/unique \(session_id, position\)/);
  });
});
