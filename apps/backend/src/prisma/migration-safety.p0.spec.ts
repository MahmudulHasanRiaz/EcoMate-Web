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
  // Row-destroying DML: a migration that deletes rows is unrecoverable (no
  // rollback SQL exists for any migration) and must be reviewed explicitly.
  /^\s*DELETE\s+FROM\b/im,
  /^\s*TRUNCATE\b/im,
];

/**
 * Narrow exemptions: migration folder name → patterns it is allowed to match.
 * Every entry must be a one-off schema↔DB drift alignment whose data loss was
 * verified before the migration shipped (row counts / reference checks noted).
 */
const ALLOWED_DESTRUCTIVE: Record<string, RegExp[]> = {
  // 2026-09-28 alignment: dropped JournalEntry.marketingPaymentId (0 rows, no
  // schema reference), its unique index, AdAccount.defaultPaymentAccountId_idx
  // (not present in schema.prisma) — DB matched history after checksum fix.
  '20260928000110_align_schema_db_drift': [
    /^\s*ALTER\s+TABLE\b[^;]*\bDROP\s+COLUMN\b/im,
    /^\s*DROP\s+INDEX\b/im,
  ],
  // sourceHeaders addition + drift alignment: the singleton unique on
  // PhysicalReservation(orderItemId) predates the composite unique
  // (orderItemId, cycleId) in the datamodel; it would block legitimate
  // multi-cycle reservations (DB stricter than schema).
  '20260928000300_invoice_source_headers': [/^\s*DROP\s+INDEX\b/im],
  // One-off purge of courier-settlement invoices that were discarded before
  // finalization (test/draft artifacts only; no finalized invoice, journal or
  // reconciliation row is touched). Pre-dates this pattern's addition.
  '20260928000400_purge_discarded_invoices': [/^\s*DELETE\s+FROM\b/im],
};

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
      const folder = path.basename(path.dirname(f));
      const allowed = ALLOWED_DESTRUCTIVE[folder] ?? [];
      for (const re of DESTRUCTIVE_PATTERNS) {
        // RegExp literals are fresh objects — compare by source+flags, not identity.
        if (allowed.some((a) => a.source === re.source && a.flags === re.flags)) continue;
        if (re.test(sql)) violations.push(`${f} matches ${re}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('no post-P0 migration rewrites a table (no DROP+CREATE pair)', () => {
    const dir = path.resolve(__dirname, '..', '..', 'prisma', 'migrations');
    // NOTE (P1): jest `expect` takes one argument — the two-arg form threw
    // unconditionally once a first gated migration existed. Collect-then-assert.
    const offenders: string[] = [];
    for (const f of postP0Migrations(dir)) {
      const sql = fs.readFileSync(f, 'utf8');
      const drops = /DROP\s+TABLE/i.test(sql);
      const creates = /CREATE\s+TABLE/i.test(sql);
      if (drops && creates) offenders.push(f);
    }
    expect(offenders).toEqual([]);
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
