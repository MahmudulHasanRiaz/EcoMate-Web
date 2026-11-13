/**
 * Migration SQL table-name validation — the 20261113160000 lesson.
 *
 * Migration `20261113160000_storefront_fully_dynamic` shipped an INSERT with
 * `FROM "UserProfile"`, but no `"UserProfile"` table exists: the UserProfile
 * model maps to the `"User"` table via `@@map("User")`. The migration fails
 * deterministically on ANY database, yet Build Images went GREEN — because no
 * pipeline step ever executes migration SQL (guards are fs-only regexes for
 * destructive patterns, unit tests mock the DB, `prisma validate` checks the
 * schema only, Docker only compiles). Staging crash-looped on deploy.
 *
 * This spec closes that hole statically, with no database: every quoted table
 * reference in every `migration.sql` must name a REAL table — a model from
 * `schema.prisma` (through its `@@map`, when present) or a table created by
 * some migration in the repo. A model name used where its mapped table name
 * belongs (quoted or bare) fails the check.
 *
 * Scope notes (deliberate, to avoid false positives on 190+ historical files):
 * - Valid tables = current schema tables ∪ tables created by ANY migration.
 *   A legacy table created by `db push` and later dropped from the schema
 *   would still be caught — that is a real gap, not noise; add it to
 *   KNOWN_LEGACY_TABLES below with a one-line reason if it ever trips.
 * - System catalogs (`pg_*`, `information_schema`) and `_prisma_migrations`
 *   are allowlisted — migrations legitimately read them.
 * - SQL inside line comments, block comments, `'...'` strings and `$tag$...$tag$`
 *   dollar-quoted blocks (the 170000 JSON blob, PL/pgSQL DO bodies) is
 *   stripped before matching, so fake data can never trip the check.
 * - `ALTER TYPE "X"` names are validated against schema enums ∪ types
 *   created by migrations.
 *
 * Test overrides (for proving the check catches a bug): MIGRATIONS_DIR and
 * SCHEMA_PRISMA_PATH env vars point the spec at a copied tree.
 */
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'prisma', 'migrations');
const DEFAULT_SCHEMA_PRISMA = path.resolve(__dirname, '..', '..', 'prisma', 'schema.prisma');

/**
 * Legacy tables a migration may legitimately reference even though no current
 * model and no migration CREATEs them (db-push era leftovers). Empty today —
 * add entries only with a one-line reason each.
 */
const KNOWN_LEGACY_TABLES: Record<string, string> = {};

const SYSTEM_TABLES = new Set(['_prisma_migrations']);

/** A quoted identifier, optionally schema-qualified: "public"."User" → User. */
const Q = '(?:"[^"]+"\\.)?"([^"]+)"';

function migrationsDir(): string {
  return process.env.MIGRATIONS_DIR
    ? path.resolve(process.env.MIGRATIONS_DIR)
    : DEFAULT_MIGRATIONS_DIR;
}

function schemaPrismaPath(): string {
  return process.env.SCHEMA_PRISMA_PATH
    ? path.resolve(process.env.SCHEMA_PRISMA_PATH)
    : DEFAULT_SCHEMA_PRISMA;
}

/**
 * Single-pass SQL cleaner: drops line and block comments, `'...'` string
 * literals ('' escaped) and `$tag$...$tag$` dollar-quoted blocks; keeps
 * `"..."` identifiers (table names) verbatim.
 */
export function stripSql(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1] ?? '';
    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' ';
      continue;
    }
    if (ch === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += ' ';
      continue;
    }
    if (ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? n : end + tag.length;
        out += ' ';
        continue;
      }
      out += ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

interface SchemaInfo {
  /** Real table names: model name mapped through @@map, else the model name. */
  tables: Set<string>;
  /** Model name → real table name, only where they differ. */
  mappedModels: Map<string, string>;
  enums: Set<string>;
}

export function parseSchema(schemaPath: string): SchemaInfo {
  const src = fs.readFileSync(schemaPath, 'utf8');
  const tables = new Set<string>();
  const mappedModels = new Map<string, string>();
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(src))) {
    const model = m[1];
    const map = /@@map\("([^"]+)"\)/.exec(m[2]);
    const table = map ? map[1] : model;
    tables.add(table);
    if (table !== model) mappedModels.set(model, table);
  }
  const enums = new Set<string>();
  const enumRe = /enum\s+(\w+)\s*\{/g;
  while ((m = enumRe.exec(src))) enums.add(m[1]);
  return { tables, mappedModels, enums };
}

function migrationFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d/.test(e.name))
    .map((e) => path.join(dir, e.name, 'migration.sql'))
    .filter((f) => fs.existsSync(f))
    .sort();
}

/** Table positions: keyword → captured table name. */
const TABLE_PATTERNS: RegExp[] = [
  new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${Q}`, 'gi'),
  new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${Q}`, 'gi'),
  new RegExp(`DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${Q}`, 'gi'),
  new RegExp(`INSERT\\s+INTO\\s+${Q}`, 'gi'),
  new RegExp(`UPDATE\\s+(?:ONLY\\s+)?${Q}`, 'gi'),
  new RegExp(`DELETE\\s+FROM\\s+(?:ONLY\\s+)?${Q}`, 'gi'),
  new RegExp(`\\bFROM\\s+${Q}`, 'gi'),
  new RegExp(`\\bJOIN\\s+${Q}`, 'gi'),
  new RegExp(`\\bREFERENCES\\s+${Q}`, 'gi'),
  new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"[^"]+"\\s+ON\\s+(?:ONLY\\s+)?${Q}`, 'gi'),
  new RegExp(`TRUNCATE\\s+(?:TABLE\\s+)?${Q}`, 'gi'),
  new RegExp(`COMMENT\\s+ON\\s+TABLE\\s+${Q}`, 'gi'),
];

/** Type positions: only ALTER TYPE names a type that must already exist. */
const TYPE_PATTERNS: RegExp[] = [new RegExp(`ALTER\\s+TYPE\\s+${Q}`, 'gi')];

function isSystemTable(name: string): boolean {
  return (
    SYSTEM_TABLES.has(name) ||
    name.startsWith('pg_') ||
    name === 'information_schema' ||
    name.startsWith('information_schema.')
  );
}

interface Violation {
  file: string;
  name: string;
  kind: 'table' | 'type' | 'model-name';
  detail: string;
}

export function validateMigrationSql(
  dir: string,
  schemaPath: string,
): Violation[] {
  const schema = parseSchema(schemaPath);
  const files = migrationFiles(dir);

  // Valid tables: current schema ∪ every table any migration CREATEs.
  const validTables = new Set<string>([...schema.tables, ...Object.keys(KNOWN_LEGACY_TABLES)]);
  const createdTypes = new Set<string>();
  const cleaned = new Map<string, string>();
  for (const f of files) {
    const clean = stripSql(fs.readFileSync(f, 'utf8'));
    cleaned.set(f, clean);
    for (const m of clean.matchAll(
      new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${Q}`, 'gi'),
    )) {
      validTables.add(m[1]);
    }
    for (const m of clean.matchAll(
      new RegExp(`CREATE\\s+TYPE\\s+${Q}`, 'gi'),
    )) {
      createdTypes.add(m[1]);
    }
  }
  const validTypes = new Set<string>([...schema.enums, ...createdTypes]);

  const violations: Violation[] = [];
  const seen = new Set<string>();
  const push = (file: string, name: string, kind: Violation['kind'], detail: string) => {
    const key = `${file}|${name}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ file, name, kind, detail });
  };

  for (const f of files) {
    const clean = cleaned.get(f) ?? '';
    const folder = path.basename(path.dirname(f));
    for (const re of TABLE_PATTERNS) {
      re.lastIndex = 0;
      for (const m of clean.matchAll(re)) {
        const name = m[1];
        if (!validTables.has(name) && !isSystemTable(name)) {
          push(f, name, 'table', `${folder}: references unknown table "${name}"`);
        }
      }
    }
    for (const re of TYPE_PATTERNS) {
      re.lastIndex = 0;
      for (const m of clean.matchAll(re)) {
        const name = m[1];
        if (!validTypes.has(name)) {
          push(f, name, 'type', `${folder}: ALTER TYPE names unknown enum "${name}"`);
        }
      }
    }
    // Bare model-name trap: `FROM UserProfile` (no quotes) is the same bug.
    for (const [model, table] of schema.mappedModels) {
      const bare = new RegExp(
        `\\b(?:FROM|JOIN|REFERENCES|INTO|UPDATE|TABLE)\\s+${model}\\b`,
        'gi',
      );
      if (bare.test(clean)) {
        push(
          f,
          model,
          'model-name',
          `${folder}: uses model name "${model}" where table "${table}" belongs`,
        );
      }
    }
  }
  return violations.sort((a, b) =>
    a.file === b.file ? a.name.localeCompare(b.name) : a.file.localeCompare(b.file),
  );
}

describe('Migration SQL table-name validation (20261113160000 lesson)', () => {
  it('every quoted table reference in every migration.sql names a real table', () => {
    const violations = validateMigrationSql(migrationsDir(), schemaPrismaPath()).filter(
      (v) => v.kind === 'table',
    );
    expect(
      violations.map((v) => `${v.file}: ${v.detail}`),
    ).toEqual([]);
  });

  it('every ALTER TYPE names a real enum', () => {
    const violations = validateMigrationSql(migrationsDir(), schemaPrismaPath()).filter(
      (v) => v.kind === 'type',
    );
    expect(
      violations.map((v) => `${v.file}: ${v.detail}`),
    ).toEqual([]);
  });

  it('no migration uses a model name where its mapped table name belongs', () => {
    const violations = validateMigrationSql(migrationsDir(), schemaPrismaPath()).filter(
      (v) => v.kind === 'model-name',
    );
    expect(
      violations.map((v) => `${v.file}: ${v.detail}`),
    ).toEqual([]);
  });
});
