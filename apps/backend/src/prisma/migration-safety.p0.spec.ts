/**
 * P0 — production migration safety (§16 items 1, 6, 11, 12).
 *
 * The additive-only rule applies to migrations authored from P0 onward
 * (cutoff below). Historical migrations pre-date the programme and are
 * excluded — they are evidence of why the rule exists, not violations.
 */
import * as fs from 'fs';
import * as path from 'path';

/** P0 baseline: only migrations sorting AFTER this prefix are gated. */
export const P0_MIGRATION_CUTOFF = '20260925';

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /^\s*DROP\s+TABLE\b/im,
  /^\s*ALTER\s+TABLE\b[^;]*\bDROP\s+COLUMN\b/im,
  /ALTER\s+TYPE\b[^;]*\bDROP\s+VALUE\b/im,
  /^\s*DROP\s+INDEX\b/im,
];

function postP0Migrations(migrationsDir: string): string[] {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name > P0_MIGRATION_CUTOFF)
    .map((e) => path.join(migrationsDir, e.name, 'migration.sql'))
    .filter((f) => fs.existsSync(f));
}

describe('P0 migration safety — additive migrations only (§16.1, §16.6)', () => {
  it('no post-P0 migration drops tables/columns/enum values/indexes', () => {
    const dir = path.resolve(__dirname, '..', '..', 'prisma', 'migrations');
    const files = postP0Migrations(dir);
    const violations: string[] = [];
    for (const f of files) {
      const sql = fs.readFileSync(f, 'utf8');
      for (const re of DESTRUCTIVE_PATTERNS) {
        if (re.test(sql)) violations.push(`${f} matches ${re}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('no post-P0 migration rewrites a table (no DROP+CREATE pair)', () => {
    const dir = path.resolve(__dirname, '..', '..', 'prisma', 'migrations');
    for (const f of postP0Migrations(dir)) {
      const sql = fs.readFileSync(f, 'utf8');
      const drops = /DROP\s+TABLE/i.test(sql);
      const creates = /CREATE\s+TABLE/i.test(sql);
      expect(
        drops && creates,
        `${f}: table rewrite detected`,
      ).toBe(false);
    }
  });
});

describe('P0 self-heal drift contract (R-10, §16.12)', () => {
  it('self-heal entry points stay restore-gated and logged', () => {
    const svc = fs.readFileSync(
      path.resolve(__dirname, 'prisma.service.ts'),
      'utf8',
    );
    // Restore/write-block gate runs before any repair attempt.
    expect(svc).toMatch(/isRestoreWriteBlocked/);
    // Dev-only auto-heal path exists and is environment-gated.
    expect(svc).toMatch(/NODE_ENV/);
    expect(svc).toMatch(/dropStaleColumns|autoHealSchema/);
  });
});
