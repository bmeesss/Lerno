#!/usr/bin/env node
/**
 * Real-Postgres safety net for `database/migrations`.
 *
 * Proves, against an actual PostgreSQL server, that the whole migration chain
 * (0001 … the newest file):
 *
 *   A. succeeds on an empty database,
 *   B. succeeds again on the same database,
 *   C. succeeds on every further run (default: 3 consecutive runs + one
 *      "paste everything at once" run inside a single transaction, the way the
 *      Supabase SQL editor executes a script),
 *   D. leaves the schema (tables, columns, constraints, indexes, triggers,
 *      functions, RLS flags, policies, privileges) identical between the runs,
 *   E. keeps every existing row untouched (row counts + a checksum over all
 *      rows, including updated_at, so a stray UPDATE is caught) and does not
 *      duplicate the backfilled study_packs / study_pack_sources rows,
 *   F. keeps the row-level security rules working (owner / other user / guest /
 *      admin, public vs private, plus the 0006 profile column privileges).
 *
 * It also emulates the small part of Supabase the migrations rely on
 * (`auth.users`, `auth.uid()`, `auth.jwt()`, the `anon` / `authenticated` /
 * `service_role` roles and their default table grants). That emulation lives in
 * this test file only; it is never shipped to production.
 *
 * Usage (needs a reachable PostgreSQL server and the `pg` package):
 *
 *   PGURL=postgres://postgres@127.0.0.1:5432/postgres \
 *     node database/tests/migration-rerun.mjs
 *
 * Options:
 *   --dir <path>            migrations under test (default database/migrations)
 *   --baseline-dir <path>   additionally migrate a scratch database with these
 *                           files once and require an identical schema snapshot
 *                           (used to prove the re-runnable chain still produces
 *                           the schema of the original, non-re-runnable chain)
 *   --runs <n>              consecutive runs (default 3, minimum 2)
 *   --keep                  keep the scratch databases instead of dropping them
 *
 * Environment: PGHOST/PGPORT/PGUSER/PGPASSWORD (or PGURL / DATABASE_URL),
 * PGDATABASE (maintenance database, default "postgres"), PGTEST_DATABASE
 * (default lerno_migration_test), PGBASELINE_DATABASE
 * (default lerno_migration_baseline).
 */
/* eslint no-console: off -- This is a test CLI; its check report is the output. */
import console from 'node:console';
import process from 'node:process';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

// --- arguments --------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const migrationsDir = path.resolve(repoRoot, arg('dir', 'database/migrations'));
const baselineDir = arg('baseline-dir', null);
const runs = Math.max(2, Number(arg('runs', '3')));
const keep = flag('keep');
const testDatabase = process.env.PGTEST_DATABASE ?? 'lerno_migration_test';
const baselineDatabase = process.env.PGBASELINE_DATABASE ?? 'lerno_migration_baseline';
const partialDatabase = process.env.PGPARTIAL_DATABASE ?? 'lerno_migration_partial_test';
const maintenanceDatabase = process.env.PGDATABASE ?? 'postgres';

for (const name of [testDatabase, partialDatabase, baselineDir ? baselineDatabase : null]) {
  if (name && !/(_test|_baseline)$/.test(name)) {
    console.error(
      `refusing to run against "${name}": the scratch database name must end in "_test" or "_baseline"`,
    );
    process.exit(2);
  }
}

let pg;
try {
  ({ default: pg } = await import('pg'));
} catch {
  console.error(
    'the "pg" package is required for this test: npm install --no-save pg\n' +
      '(nothing is added to package.json; the test only needs it locally)',
  );
  process.exit(2);
}

// --- tiny test runner -------------------------------------------------------

let failures = 0;
let checks = 0;
const check = (label, condition, detail = '') => {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};
const section = (title) => console.log(`\n== ${title}`);

// --- connection helpers -----------------------------------------------------

const connectionConfig = (database) => {
  const url = process.env.PGURL ?? process.env.DATABASE_URL;
  if (url) {
    const parsed = new URL(url);
    parsed.pathname = `/${database}`;
    return { connectionString: parsed.toString() };
  }
  return {
    host: process.env.PGHOST ?? '/var/run/postgresql',
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    user: process.env.PGUSER ?? process.env.USER,
    password: process.env.PGPASSWORD,
    database,
  };
};

const connect = async (database) => {
  const client = new pg.Client(connectionConfig(database));
  await client.connect();
  return client;
};

const freshDatabase = async (name) => {
  const admin = await connect(maintenanceDatabase);
  try {
    await admin.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [name],
    );
    await admin.query(`drop database if exists "${name}"`);
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
};

const dropDatabase = async (name) => {
  const admin = await connect(maintenanceDatabase);
  try {
    await admin.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [name],
    );
    await admin.query(`drop database if exists "${name}"`);
  } finally {
    await admin.end();
  }
};

// --- Supabase emulation (test-only) -----------------------------------------

const SUPABASE_SHIM = `
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

do $shim$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit;
  end if;
end
$shim$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants ALL on new tables in the public schema through default
-- privileges; 0006 revokes INSERT/UPDATE on public.profiles on top of that.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

// --- migrations -------------------------------------------------------------

const listMigrations = (dir) =>
  readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

const runMigrations = async (client, dir, { singleTransaction = false, only = null } = {}) => {
  const files = only ?? listMigrations(dir);
  const results = [];
  if (singleTransaction) await client.query('begin');
  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), 'utf8');
    const started = Date.now();
    try {
      if (!singleTransaction) await client.query('begin');
      await client.query(sql);
      if (!singleTransaction) await client.query('commit');
      results.push({ file, ms: Date.now() - started });
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        /* the connection may already be unusable */
      }
      error.message = `${file}: ${error.message}`;
      throw error;
    }
  }
  if (singleTransaction) await client.query('commit');
  return results;
};

// --- schema snapshot --------------------------------------------------------

const SNAPSHOT_QUERIES = {
  relations: `
    select c.relname as name, c.relkind as kind, c.relrowsecurity as rls,
           c.relforcerowsecurity as force_rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
    order by c.relname`,
  columns: `
    select table_name, ordinal_position, column_name, data_type, udt_name,
           is_nullable, column_default, character_maximum_length, numeric_precision,
           numeric_scale, is_identity, identity_generation
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position`,
  constraints: `
    select c.relname as table_name, con.conname, con.contype,
           pg_get_constraintdef(con.oid) as definition, con.condeferrable, con.convalidated
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and con.contype in ('p', 'u', 'f', 'c', 'x')
    order by c.relname, con.conname`,
  indexes: `
    select tablename, indexname, indexdef
    from pg_indexes
    where schemaname = 'public'
    order by tablename, indexname`,
  triggers: `
    select n.nspname as schema_name, c.relname as table_name, t.tgname,
           pg_get_triggerdef(t.oid) as definition, t.tgenabled
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname in ('public', 'auth')
    order by n.nspname, c.relname, t.tgname`,
  functions: `
    select n.nspname as schema_name, p.proname, pg_get_functiondef(p.oid) as definition,
           p.prosecdef, p.provolatile, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'auth')
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
      and p.prokind = 'f'
    order by n.nspname, p.proname`,
  policies: `
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname in ('public', 'auth')
    order by tablename, policyname`,
  tablePrivileges: `
    select table_schema, table_name, grantee, privilege_type, is_grantable
    from information_schema.role_table_grants
    where table_schema = 'public'
    order by table_name, grantee, privilege_type`,
  columnPrivileges: `
    select table_schema, table_name, column_name, grantee, privilege_type, is_grantable
    from information_schema.role_column_grants
    where table_schema = 'public'
    order by table_name, column_name, grantee, privilege_type`,
  extensions: `
    select extname, extversion, n.nspname as schema_name
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    order by extname`,
};

const schemaSnapshot = async (client) => {
  const snapshot = {};
  for (const [name, sql] of Object.entries(SNAPSHOT_QUERIES)) {
    const { rows } = await client.query(sql);
    snapshot[name] = rows;
  }
  return snapshot;
};

const snapshotHash = (snapshot) =>
  createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 12);

const snapshotDiff = (a, b) => {
  const differences = [];
  for (const key of Object.keys(a)) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    const left = JSON.stringify(a[key], null, 1).split('\n');
    const right = JSON.stringify(b[key], null, 1).split('\n');
    let index = 0;
    while (index < Math.max(left.length, right.length) && left[index] === right[index]) index += 1;
    differences.push(
      `${key}: before ${left.slice(index, index + 3).join(' ')} / after ${right
        .slice(index, index + 3)
        .join(' ')}`,
    );
  }
  return differences;
};

// --- fixtures ---------------------------------------------------------------

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';
const ALICE_PUBLIC_SET = 'a1000000-0000-4000-8000-000000000001';
const ALICE_PRIVATE_SET = 'a1000000-0000-4000-8000-000000000002';
const BOB_PUBLIC_SET = 'b1000000-0000-4000-8000-000000000001';
const BOB_PRIVATE_SET = 'b1000000-0000-4000-8000-000000000002';
const ALICE_PACK = 'c1000000-0000-4000-8000-000000000001';
const ALICE_CONCEPT = 'd1000000-0000-4000-8000-000000000001';
const ALICE_QUIZ_PUBLIC = 'aa000000-0000-4000-8000-000000000001';
const BOB_QUIZ_PRIVATE = 'aa000000-0000-4000-8000-000000000003';
const ALICE_SESSION = 'b1000000-0000-4000-8000-000000000001';
const ALICE_QUESTION = 'af000000-0000-4000-8000-000000000001';

const DATA_TABLES = [
  'profiles',
  'subjects',
  'study_sets',
  'cards',
  'card_progress',
  'quizzes',
  'quiz_questions',
  'quiz_attempts',
  'study_sessions',
  'favorites',
  'reports',
  'study_packs',
  'study_pack_sources',
  'concepts',
  'concept_mastery',
  'practice_questions',
  'practice_attempts',
  'tests',
  'test_questions',
  'test_attempts',
  'study_plans',
  'learning_events',
  'learning_sessions',
  'learning_session_items',
  'mastery_snapshots',
];

const FIXTURES = `
set time zone 'UTC';

-- Auth users: the 0001 trigger has to create the profiles for them.
insert into auth.users (id, email, raw_user_meta_data) values
  ('${ALICE}', 'alice@example.test', '{"display_name":"Alice"}'::jsonb),
  ('${BOB}', 'bob@example.test', '{"display_name":"Bob"}'::jsonb),
  ('${CAROL}', 'carol@example.test', '{"display_name":"Carol"}'::jsonb);

update public.profiles set role = 'admin' where id = '${CAROL}';

insert into public.subjects (id, owner_id, name)
values ('e1000000-0000-4000-8000-000000000001', '${ALICE}', 'Biology');

insert into public.study_sets
  (id, owner_id, subject_id, subject_name, title, slug, description, level, visibility, tags)
values
  ('${ALICE_PUBLIC_SET}', '${ALICE}', 'e1000000-0000-4000-8000-000000000001', 'Biology',
   'Alice public set', 'alice-public', '', 'havo', 'public', '{bio,examen}'),
  ('${ALICE_PRIVATE_SET}', '${ALICE}', null, null, 'Alice private set', 'alice-private',
   '', '', 'private', '{}'),
  ('${BOB_PUBLIC_SET}', '${BOB}', null, null, 'Bob public set', 'bob-public', '', '', 'public', '{}'),
  ('${BOB_PRIVATE_SET}', '${BOB}', null, null, 'Bob private set', 'bob-private', '', '', 'private', '{}');

insert into public.cards (id, set_id, question, answer, position) values
  ('f1000000-0000-4000-8000-000000000001', '${ALICE_PUBLIC_SET}', 'Wat is DNA?', 'Erfelijk materiaal', 0),
  ('f1000000-0000-4000-8000-000000000002', '${ALICE_PUBLIC_SET}', 'Wat is een cel?', 'Bouwsteen', 1),
  ('f1000000-0000-4000-8000-000000000003', '${ALICE_PRIVATE_SET}', 'Prive vraag?', 'Prive antwoord', 0),
  ('f1000000-0000-4000-8000-000000000004', '${BOB_PRIVATE_SET}', 'Bob vraag?', 'Bob antwoord', 0);

insert into public.card_progress (user_id, card_id, repetition_count, ease, correct_count)
values ('${ALICE}', 'f1000000-0000-4000-8000-000000000001', 3, 2.5, 2);

insert into public.quizzes (id, set_id, title) values
  ('${ALICE_QUIZ_PUBLIC}', '${ALICE_PUBLIC_SET}', 'Alice public quiz'),
  ('aa000000-0000-4000-8000-000000000002', '${ALICE_PRIVATE_SET}', 'Alice private quiz'),
  ('${BOB_QUIZ_PRIVATE}', '${BOB_PRIVATE_SET}', 'Bob private quiz');

insert into public.quiz_questions (quiz_id, prompt, question_type, correct_answer, position) values
  ('${ALICE_QUIZ_PUBLIC}', 'DNA?', 'short_answer', 'Erfelijk materiaal', 0),
  ('aa000000-0000-4000-8000-000000000002', 'Cel?', 'short_answer', 'Bouwsteen', 0),
  ('${BOB_QUIZ_PRIVATE}', 'Bob?', 'short_answer', 'Bob', 0);

insert into public.quiz_attempts (user_id, quiz_id, score, total)
values ('${ALICE}', '${ALICE_QUIZ_PUBLIC}', 1, 1);

insert into public.study_sessions (id, user_id, set_id, cards_seen)
values ('ab000000-0000-4000-8000-000000000001', '${ALICE}', '${ALICE_PUBLIC_SET}', 2);

insert into public.favorites (user_id, set_id) values ('${ALICE}', '${BOB_PUBLIC_SET}');

insert into public.reports (id, reporter_id, target_type, target_id, reason, status) values
  ('ac000000-0000-4000-8000-000000000001', '${ALICE}', 'study_set', '${BOB_PUBLIC_SET}', 'Spam', 'open'),
  ('ac000000-0000-4000-8000-000000000002', '${BOB}', 'study_set', '${ALICE_PUBLIC_SET}', 'Spam', 'open');

-- A study pack that already exists before the 0007 backfill runs again: the
-- backfill must neither duplicate it nor add a second source row for it.
insert into public.study_packs
  (id, owner_id, title, description, level, visibility, legacy_set_id, owns_legacy_set)
values
  ('${ALICE_PACK}', '${ALICE}', 'Alice private set', '', '', 'private', '${ALICE_PRIVATE_SET}', false);

insert into public.study_pack_sources
  (id, pack_id, owner_id, kind, title, status, character_count, legacy_set_id, origin)
values
  ('ad000000-0000-4000-8000-000000000001', '${ALICE_PACK}', '${ALICE}', 'set',
   'Alice private set', 'ready', 42, '${ALICE_PRIVATE_SET}', 'imported');

insert into public.concepts (id, pack_id, source_id, name, explanation, position)
values ('${ALICE_CONCEPT}', '${ALICE_PACK}', 'ad000000-0000-4000-8000-000000000001',
        'Mitose', 'Celdeling', 0);

-- Confidence 0.5 with real study history: exactly the value a naive
-- "where confidence = 0.5" backfill in 0009 would clobber on a second run.
insert into public.concept_mastery
  (id, user_id, concept_id, mastery, confidence, attempts, correct_count, incorrect_count,
   last_practiced_at)
values
  ('ae000000-0000-4000-8000-000000000001', '${ALICE}', '${ALICE_CONCEPT}', 0.4, 0.5, 4, 1, 1,
   timestamptz '2026-01-01 10:00:00+00');

insert into public.practice_questions
  (id, pack_id, concept_id, prompt, question_type, correct_answer, position)
values
  ('${ALICE_QUESTION}', '${ALICE_PACK}', '${ALICE_CONCEPT}', 'Wat is mitose?', 'short_answer',
   'Celdeling', 0);

insert into public.practice_attempts (user_id, pack_id, question_id, concept_id, answer, verdict)
values ('${ALICE}', '${ALICE_PACK}', '${ALICE_QUESTION}', '${ALICE_CONCEPT}', 'Celdeling', 'correct');

insert into public.tests (id, pack_id, owner_id, title, mode, question_count)
values ('b0000000-0000-4000-8000-000000000001', '${ALICE_PACK}', '${ALICE}', 'Test', 'quick10', 1);

insert into public.test_questions (test_id, question_id, position)
values ('b0000000-0000-4000-8000-000000000001', '${ALICE_QUESTION}', 0);

insert into public.test_attempts (test_id, pack_id, user_id, score, total, correct_count)
values ('b0000000-0000-4000-8000-000000000001', '${ALICE_PACK}', '${ALICE}', 100, 1, 1);

insert into public.study_plans (pack_id, owner_id, overview)
values ('${ALICE_PACK}', '${ALICE}', 'Plan');

insert into public.learning_events (user_id, pack_id, concept_id, event_type, is_correct)
values ('${ALICE}', '${ALICE_PACK}', '${ALICE_CONCEPT}', 'practice', true);

insert into public.learning_sessions
  (id, user_id, pack_id, type, status, title, item_count, answered_count, duration_seconds)
values ('${ALICE_SESSION}', '${ALICE}', '${ALICE_PACK}', 'practice', 'completed', 'Sessie', 1, 1, 120);

insert into public.learning_session_items
  (session_id, user_id, pack_id, position, kind, concept_id, question_id, status, answer, verdict)
values ('${ALICE_SESSION}', '${ALICE}', '${ALICE_PACK}', 0, 'question', '${ALICE_CONCEPT}',
        '${ALICE_QUESTION}', 'answered', 'Celdeling', 'correct');

insert into public.mastery_snapshots (user_id, pack_id, day, mastery_percent, concepts_total)
values ('${ALICE}', '${ALICE_PACK}', date '2026-01-02', 40, 1);
`;

const dataDigest = async (client, tables = DATA_TABLES) => {
  await client.query("set time zone 'UTC'");
  const digest = {};
  for (const table of tables) {
    const { rows } = await client.query(
      `select count(*)::int as count,
              md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as digest
       from (select to_jsonb(t.*) as x from public.${table} t) s`,
    );
    digest[table] = rows[0];
  }
  return digest;
};

/**
 * Tables the 0007 backfill is allowed to *fill* (never rewrite): a study set
 * that was created after the first run gets its pack and its "set" source the
 * next time the chain runs. Everything else has to stay byte-identical.
 */
const BACKFILL_TABLES = ['study_packs', 'study_pack_sources'];

/** Checksum of the rows of one table that match `where`. */
const rowDigest = async (client, table, where) => {
  await client.query("set time zone 'UTC'");
  const { rows } = await client.query(
    `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as digest
     from (select to_jsonb(t.*) as x from public.${table} t where ${where}) s`,
  );
  return rows[0].digest;
};

const withoutBackfillTables = (digest) =>
  Object.fromEntries(Object.entries(digest).filter(([table]) => !BACKFILL_TABLES.includes(table)));

const digestDiff = (before, after) => {
  const differences = [];
  for (const table of Object.keys(before)) {
    const a = before[table];
    const b = after[table];
    if (a.count !== b.count) {
      differences.push(`${table}: ${a.count} rows became ${b.count} rows`);
    } else if (a.digest !== b.digest) {
      differences.push(`${table}: the ${a.count} rows changed`);
    }
  }
  return differences;
};

// --- row-level security probes ---------------------------------------------

const runAs = async (client, role, claims, sql) => {
  await client.query('begin');
  try {
    await client.query(`set local role ${role}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      claims ? JSON.stringify(claims) : '',
    ]);
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [claims?.sub ?? '']);
    const result = await client.query(sql);
    return { rows: result.rows, error: null };
  } catch (error) {
    return { rows: [], error };
  } finally {
    await client.query('rollback');
  }
};

const rlsProbes = async (client) => {
  const alice = { sub: ALICE, role: 'authenticated' };
  const bob = { sub: BOB, role: 'authenticated' };
  const carol = { sub: CAROL, role: 'authenticated' };
  const carolOauth = { sub: CAROL, role: 'authenticated', client_id: 'mcp-client' };

  const visible = async (role, claims, table, where = 'true') => {
    const { rows, error } = await runAs(
      client,
      role,
      claims,
      `select count(*)::int as count from public.${table} where ${where}`,
    );
    return error ? `error: ${error.message}` : rows[0].count;
  };

  const statement = async (role, claims, sql) => {
    const { error } = await runAs(client, role, claims, sql);
    return error ? 'error' : 'ok';
  };

  const changedCount = async (role, claims, sql) => {
    const { rows, error } = await runAs(
      client,
      role,
      claims,
      `with changed as (${sql} returning 1) select count(*)::int as count from changed`,
    );
    return error ? `error: ${error.message}` : rows[0].count;
  };

  const scalar = async (role, claims, sql) => {
    const { rows, error } = await runAs(client, role, claims, sql);
    return error ? `error: ${error.message}` : rows[0][Object.keys(rows[0])[0]];
  };

  return [
    [
      'guest sees only public sets',
      await visible('anon', null, 'study_sets', "visibility = 'public'"),
      2,
    ],
    [
      'guest cannot fetch a private set by id',
      await visible('anon', null, 'study_sets', `id = '${ALICE_PRIVATE_SET}'`),
      0,
    ],
    [
      'alice sees her own private set',
      await visible('authenticated', alice, 'study_sets', `id = '${ALICE_PRIVATE_SET}'`),
      1,
    ],
    [
      'alice cannot see the private set of bob',
      await visible('authenticated', alice, 'study_sets', `id = '${BOB_PRIVATE_SET}'`),
      0,
    ],
    [
      'alice sees the public set of bob',
      await visible('authenticated', alice, 'study_sets', `id = '${BOB_PUBLIC_SET}'`),
      1,
    ],
    [
      'guest sees the cards of a public set',
      await visible('anon', null, 'cards', `set_id = '${ALICE_PUBLIC_SET}'`),
      2,
    ],
    [
      'guest sees no cards of a private set',
      await visible('anon', null, 'cards', `set_id = '${ALICE_PRIVATE_SET}'`),
      0,
    ],
    ['alice sees her own card progress', await visible('authenticated', alice, 'card_progress'), 1],
    ['bob sees no card progress of alice', await visible('authenticated', bob, 'card_progress'), 0],
    ['alice sees her own report', await visible('authenticated', alice, 'reports'), 1],
    [
      'alice sees no report of bob',
      await visible('authenticated', alice, 'reports', `reporter_id = '${BOB}'`),
      0,
    ],
    ['guest sees no reports', await visible('anon', null, 'reports'), 0],
    ['the admin sees every report', await visible('authenticated', carol, 'reports'), 2],
    [
      'is_admin() is true for the admin',
      await scalar('authenticated', carol, 'select public.is_admin() as admin'),
      true,
    ],
    [
      'is_admin() is false for a normal user',
      await scalar('authenticated', alice, 'select public.is_admin() as admin'),
      false,
    ],
    [
      'is_admin() rejects OAuth client tokens',
      await scalar('authenticated', carolOauth, 'select public.is_admin() as admin'),
      false,
    ],
    [
      'alice sees her own learning events',
      await visible('authenticated', alice, 'learning_events'),
      1,
    ],
    [
      'bob sees no learning event of alice',
      await visible('authenticated', bob, 'learning_events'),
      0,
    ],
    ['guest sees no learning events', await visible('anon', null, 'learning_events'), 0],
    [
      'alice sees her own learning sessions',
      await visible('authenticated', alice, 'learning_sessions'),
      1,
    ],
    [
      'bob sees no learning session of alice',
      await visible('authenticated', bob, 'learning_sessions'),
      0,
    ],
    [
      'alice sees her own mastery snapshots',
      await visible('authenticated', alice, 'mastery_snapshots'),
      1,
    ],
    ['guest sees no mastery snapshots', await visible('anon', null, 'mastery_snapshots'), 0],
    [
      'bob sees no pack of alice',
      await visible('authenticated', bob, 'study_packs', `id = '${ALICE_PACK}'`),
      0,
    ],
    [
      'alice sees her own pack',
      await visible('authenticated', alice, 'study_packs', `id = '${ALICE_PACK}'`),
      1,
    ],
    [
      'alice cannot insert a card into the private set of bob',
      await statement(
        'authenticated',
        alice,
        `insert into public.cards (set_id, question, answer) values ('${BOB_PRIVATE_SET}', 'x', 'y')`,
      ),
      'error',
    ],
    [
      'alice can insert a card into her own set',
      await statement(
        'authenticated',
        alice,
        `insert into public.cards (set_id, question, answer) values ('${ALICE_PRIVATE_SET}', 'x', 'y')`,
      ),
      'ok',
    ],
    [
      'guest cannot file a report',
      await statement(
        'anon',
        null,
        `insert into public.reports (reporter_id, target_type, target_id, reason) values ('${ALICE}', 'study_set', '${BOB_PUBLIC_SET}', 'x')`,
      ),
      'error',
    ],
    [
      'alice can file a report and read it back',
      await statement(
        'authenticated',
        alice,
        `with filed as (insert into public.reports (reporter_id, target_type, target_id, reason) values ('${ALICE}', 'study_set', '${BOB_PUBLIC_SET}', 'x') returning id) select count(*) from filed`,
      ),
      'ok',
    ],
    [
      'guest can regenerate the questions of a public-set quiz',
      await statement(
        'anon',
        null,
        `insert into public.quiz_questions (quiz_id, prompt, question_type, correct_answer) values ('${ALICE_QUIZ_PUBLIC}', 'x', 'short_answer', 'y')`,
      ),
      'ok',
    ],
    [
      'guest cannot write the questions of a private-set quiz',
      await statement(
        'anon',
        null,
        `insert into public.quiz_questions (quiz_id, prompt, question_type, correct_answer) values ('${BOB_QUIZ_PRIVATE}', 'x', 'short_answer', 'y')`,
      ),
      'error',
    ],
    [
      'alice can add an item to her own session',
      await statement(
        'authenticated',
        alice,
        `insert into public.learning_session_items (session_id, user_id, pack_id, position, kind) values ('${ALICE_SESSION}', '${ALICE}', '${ALICE_PACK}', 5, 'concept')`,
      ),
      'ok',
    ],
    [
      'alice cannot add an item with the identity of bob',
      await statement(
        'authenticated',
        alice,
        `insert into public.learning_session_items (session_id, user_id, pack_id, position, kind) values ('${ALICE_SESSION}', '${BOB}', '${ALICE_PACK}', 6, 'concept')`,
      ),
      'error',
    ],
    [
      'alice can create a session for her own pack',
      await statement(
        'authenticated',
        alice,
        `insert into public.learning_sessions (user_id, pack_id, type, status) values ('${ALICE}', '${ALICE_PACK}', 'learn', 'active')`,
      ),
      'ok',
    ],
    [
      'alice cannot create a session for a pack she cannot see',
      await statement(
        'authenticated',
        bob,
        `insert into public.learning_sessions (user_id, pack_id, type, status) values ('${BOB}', '${ALICE_PACK}', 'learn', 'active')`,
      ),
      'error',
    ],
    [
      'alice can update her own display name',
      await statement(
        'authenticated',
        alice,
        `update public.profiles set display_name = 'Alice' where id = '${ALICE}'`,
      ),
      'ok',
    ],
    [
      'alice cannot promote herself to admin',
      await statement(
        'authenticated',
        alice,
        `update public.profiles set role = 'admin' where id = '${ALICE}'`,
      ),
      'error',
    ],
    [
      'alice cannot insert a profile directly',
      await statement(
        'authenticated',
        alice,
        `insert into public.profiles (id, display_name) values ('${ALICE}', 'x')`,
      ),
      'error',
    ],
    [
      'the owner renames their own pack',
      await changedCount(
        'authenticated',
        alice,
        `update public.study_packs set title = 'Alice private set' where id = '${ALICE_PACK}'`,
      ),
      1,
    ],
    [
      'a stranger cannot rename a foreign pack',
      await changedCount(
        'authenticated',
        bob,
        `update public.study_packs set title = 'hacked' where id = '${ALICE_PACK}'`,
      ),
      0,
    ],
    [
      'the owner can clear the questions of their own private quiz',
      await changedCount(
        'authenticated',
        alice,
        `delete from public.quiz_questions where quiz_id = 'aa000000-0000-4000-8000-000000000002'`,
      ),
      1,
    ],
    [
      'a guest can clear the questions of a public quiz',
      await changedCount(
        'anon',
        null,
        `delete from public.quiz_questions where quiz_id = '${ALICE_QUIZ_PUBLIC}'`,
      ),
      1,
    ],
    [
      'a guest cannot clear the questions of a private quiz',
      await changedCount(
        'anon',
        null,
        `delete from public.quiz_questions where quiz_id = '${BOB_QUIZ_PRIVATE}'`,
      ),
      0,
    ],
  ];
};

// --- main -------------------------------------------------------------------

const migrateAndCheck = async (database, dir, { label, withFixtures, expectRerunnable = true }) => {
  section(`${label} — database "${database}"`);
  await freshDatabase(database);
  const client = await connect(database);
  try {
    await client.query(SUPABASE_SHIM);

    const first = await runMigrations(client, dir);
    section(`${label} — run 1 (empty database)`);
    for (const { file, ms } of first) check(`${file} (${ms} ms)`, true);
    const snapshots = [{ label: 'run 1 (empty database)', snapshot: await schemaSnapshot(client) }];
    const runDigests = [];
    let firstDigest = null;
    let firstProbes = null;
    let firstRowDigests = null;

    if (!expectRerunnable) {
      // The original chain is the reference for "the schema must not change":
      // it is only ever applied once, exactly like it was in production.
      return { snapshot: snapshots[0].snapshot, snapshots };
    }

    if (withFixtures) {
      await client.query(FIXTURES);
      check('fixture data inserted (3 users, 4 sets, packs, learning state, reports)', true);
      firstProbes = await rlsProbes(client);
      for (const [name, value, expected] of firstProbes) {
        if (expected === undefined) continue;
        check(
          `${name} = ${JSON.stringify(value)}`,
          JSON.stringify(value) === JSON.stringify(expected),
        );
      }
      firstDigest = await dataDigest(client);
      firstRowDigests = {
        pack: await rowDigest(client, 'study_packs', `id = '${ALICE_PACK}'`),
        source: await rowDigest(
          client,
          'study_pack_sources',
          `id = 'ad000000-0000-4000-8000-000000000001'`,
        ),
        mastery: await rowDigest(client, 'concept_mastery', `concept_id = '${ALICE_CONCEPT}'`),
      };
      check('the fixtures survive their own checksum', firstDigest.study_sets.count === 4);
    }

    for (let run = 2; run <= runs; run += 1) {
      section(`${label} — run ${run} (same database, migrations already applied)`);
      let migrations;
      try {
        migrations = await runMigrations(client, dir);
      } catch (error) {
        check(`the whole chain succeeds on run ${run}`, false, error.message);
        break;
      }
      for (const { file, ms } of migrations) check(`${file} (${ms} ms)`, true);
      snapshots.push({ label: `run ${run}`, snapshot: await schemaSnapshot(client) });
      if (withFixtures) runDigests.push({ label: `run ${run}`, digest: await dataDigest(client) });
    }

    // One more time, but exactly the way the Supabase SQL editor is used: every
    // file pasted into one script, so all statements share one transaction.
    section(`${label} — whole chain in a single transaction (paste-everything run)`);
    try {
      await runMigrations(client, dir, { singleTransaction: true });
      check('0001 … newest in one transaction', true);
    } catch (error) {
      check('0001 … newest in one transaction', false, error.message);
    }
    snapshots.push({ label: 'paste-everything run', snapshot: await schemaSnapshot(client) });
    if (withFixtures) {
      runDigests.push({ label: 'paste-everything run', digest: await dataDigest(client) });
    }

    section(`${label} — schema and data must be identical after every run`);
    for (const { label: runLabel, snapshot } of snapshots.slice(1)) {
      const differences = snapshotDiff(snapshots[0].snapshot, snapshot);
      check(
        `schema after "${runLabel}" equals the schema after run 1 (hash ${snapshotHash(snapshot)})`,
        differences.length === 0,
        differences.join(' | '),
      );
    }

    if (withFixtures) {
      const after = await dataDigest(client);
      const differences = digestDiff(
        withoutBackfillTables(firstDigest),
        withoutBackfillTables(after),
      );
      check(
        'no existing row was added, changed or removed by the later runs',
        differences.length === 0,
        differences.join('; '),
      );
      check(
        'the 0.5 confidence of alice is still 0.5 (the 0009 backfill did not run twice)',
        after.concept_mastery.digest === firstDigest.concept_mastery.digest,
      );
      check(
        `the 0007 backfill filled the missing packs and set sources exactly once ` +
          `(${after.study_packs.count} packs, ${after.study_pack_sources.count} set sources)`,
        after.study_packs.count === 4 && after.study_pack_sources.count === 4,
      );
      check(
        'the pack, source and mastery rows that already existed are byte-identical',
        (await rowDigest(client, 'study_packs', `id = '${ALICE_PACK}'`)) === firstRowDigests.pack &&
          (await rowDigest(
            client,
            'study_pack_sources',
            `id = 'ad000000-0000-4000-8000-000000000001'`,
          )) === firstRowDigests.source &&
          (await rowDigest(client, 'concept_mastery', `concept_id = '${ALICE_CONCEPT}'`)) ===
            firstRowDigests.mastery,
      );
      check(
        'later runs add nothing to study_packs or study_pack_sources',
        runDigests.length >= 2 &&
          runDigests.every(
            ({ digest }) =>
              digest.study_packs.count === runDigests[0].digest.study_packs.count &&
              digest.study_pack_sources.count === runDigests[0].digest.study_pack_sources.count,
          ),
        runDigests.map(({ label, digest }) => `${label}: ${digest.study_packs.count}`).join(', '),
      );
      const afterwards = await rlsProbes(client);
      check(
        'the row-level security probes still return exactly the same answers',
        JSON.stringify(afterwards.map(([, value]) => value)) ===
          JSON.stringify(firstProbes.map(([, value]) => value)),
        JSON.stringify(afterwards.map(([name, value]) => [name, value])),
      );
    }

    return { snapshot: snapshots[0].snapshot, snapshots };
  } finally {
    await client.end();
    if (!keep) await dropDatabase(database);
  }
};

/**
 * A database where only part of the chain ever ran (someone stopped halfway, or
 * an early file was applied months before the rest) must be able to catch up by
 * running the whole chain, and must end up with the same schema.
 */
const partialChainCheck = async (database, dir, reference) => {
  section(`partial chain — database "${database}"`);
  await freshDatabase(database);
  const client = await connect(database);
  try {
    await client.query(SUPABASE_SHIM);
    const files = listMigrations(dir);
    const half = files.slice(0, Math.ceil(files.length / 2));
    if (half.length === 0 || half.length === files.length) return;
    await runMigrations(client, dir, { only: half });
    check(`only ${half.join(', ')} applied first`, true);
    await runMigrations(client, dir);
    check('the rest of the chain applies on top of the partial state', true);
    await runMigrations(client, dir);
    check('the whole chain runs again after catching up', true);
    const snapshot = await schemaSnapshot(client);
    const differences = snapshotDiff(reference, snapshot);
    check(
      'a database that was migrated in two steps ends up with the same schema',
      differences.length === 0,
      differences.join(' | '),
    );
  } finally {
    await client.end();
    if (!keep) await dropDatabase(database);
  }
};

const main = async () => {
  console.log(`migrations : ${path.relative(repoRoot, migrationsDir)}`);
  console.log(`runs       : ${runs} consecutive runs + 1 single-transaction run`);
  if (baselineDir) console.log(`baseline   : ${path.relative(repoRoot, baselineDir)}`);

  const target = await migrateAndCheck(testDatabase, migrationsDir, {
    label: 'migrations under test',
    withFixtures: true,
  });

  await partialChainCheck(partialDatabase, migrationsDir, target.snapshot);

  if (baselineDir) {
    const baseline = await migrateAndCheck(baselineDatabase, path.resolve(repoRoot, baselineDir), {
      label: 'baseline (original chain, applied once like in production)',
      withFixtures: false,
      expectRerunnable: false,
    });
    section('baseline comparison — the end state must not have changed');
    const differences = snapshotDiff(baseline.snapshot, target.snapshot);
    check(
      `the re-runnable chain produces the same schema as ${path.relative(
        repoRoot,
        path.resolve(repoRoot, baselineDir),
      )}`,
      differences.length === 0,
      differences.join(' | '),
    );
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
  }
};

try {
  await main();
} catch (error) {
  console.error(`\nmigration test crashed: ${error.message}`);
  process.exit(1);
}
