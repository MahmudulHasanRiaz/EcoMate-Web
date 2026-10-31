import * as fs from 'fs';
import * as path from 'path';
import { getAllPermissions } from '../../common/permissions/registry';

/**
 * Guards for the 2026-10-31 preset migrations (fixedplus incident +
 * owner-requested default presets):
 *
 * 1. REPAIR (20261031140000): AccessPreset.permissions must end up TEXT[]
 *    on every client DB. On fixedplus the column kept an early-era scalar
 *    shape and Prisma failed every read with "e.map is not a function".
 *    The migration must stay CONDITIONAL (no-op on healthy DBs) — these
 *    assertions keep a future edit from turning it into an unconditional
 *    reshaping of healthy client data.
 *
 * 2. SEEDS (20261031140100): the six built-in presets must (a) only ever
 *    use permission keys that exist in the live catalogue — an unknown
 *    key is silently dropped by sanitizePermissions at read time, so a
 *    typo would seed a preset that grants less than its description —
 *    and (b) use ON CONFLICT DO NOTHING, the owner's preservation rule:
 *    a redeploy must never overwrite a client's presets.
 */
const migrationsDir = path.join(__dirname, '../../../prisma/migrations');
const repairSql = fs.readFileSync(
  path.join(
    migrationsDir,
    '20261031140000_access_preset_permissions_repair/migration.sql',
  ),
  'utf8',
);
const seedSql = fs.readFileSync(
  path.join(
    migrationsDir,
    '20261031140100_seed_default_access_presets/migration.sql',
  ),
  'utf8',
);

describe('access-preset repair migration stays conditional', () => {
  it('checks the live column type via information_schema before acting', () => {
    expect(repairSql).toContain('information_schema.columns');
    expect(repairSql).toContain("col_udt = '_text'");
  });

  it('converts to TEXT[] and defensively ensures isSystem exists', () => {
    expect(repairSql).toContain('ALTER COLUMN "permissions" TYPE TEXT[]');
    expect(repairSql).toContain(
      'ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT false',
    );
  });

  it('uses the three-phase conversion and no destructive statements', () => {
    // Phase 1 retypes to TEXT (a cast that never throws), Phase 2
    // normalizes row-by-row, Phase 3 retypes to TEXT[]. A shadow-column
    // swap would need DROP COLUMN, which the repo migration-safety gate
    // forbids in post-P0 migrations — keep this file free of it.
    expect(repairSql).toContain('ALTER COLUMN "permissions" TYPE TEXT');
    expect(repairSql).not.toMatch(/DROP\s+TABLE/i);
    // Same anchoring as the repo migration-safety gate (statement level,
    // not comment prose).
    expect(repairSql).not.toMatch(/^\s*ALTER\s+TABLE\b[^;]*\bDROP\s+COLUMN\b/im);
    expect(repairSql).not.toMatch(/DELETE\s+FROM/i);
    expect(repairSql).not.toMatch(/TRUNCATE/i);
  });

  it('no stored value can abort the repair — per-row EXCEPTION fallback preserves it verbatim', () => {
    // The first version of this migration failed on fxdmostul because a
    // single ALTER ... USING (CASE ...) threw on an unanticipated stored
    // shape. The row loop must keep its guarded parse attempts and the
    // preserve-verbatim fallback.
    expect(repairSql).toContain('EXCEPTION WHEN others THEN');
    expect(repairSql).toContain('unparseable permissions value preserved verbatim');
  });
});

describe('default preset seeds', () => {
  const expectedNames = [
    'Order Operator',
    'Call Center Agent',
    'Accounts & Finance',
    'Warehouse & Packing',
    'Marketing Executive',
    'Product Catalog',
  ];

  it('seeds exactly the six standard presets as built-ins', () => {
    for (const name of expectedNames) {
      expect(seedSql).toContain(`'${name}'`);
    }
    expect(seedSql).toContain('system-preset-order-operator');
    expect(seedSql).toContain('system-preset-call-center');
    expect(seedSql).toContain('system-preset-accounts');
    expect(seedSql).toContain('system-preset-warehouse');
    expect(seedSql).toContain('system-preset-marketing');
    expect(seedSql).toContain('system-preset-catalog');
  });

  it('uses ON CONFLICT DO NOTHING — a redeploy never overwrites client data', () => {
    expect(seedSql).toContain('ON CONFLICT (name) DO NOTHING');
    expect(seedSql).not.toMatch(/DO\s+UPDATE/i);
  });

  it('every seeded permission key exists in the live catalogue', () => {
    const known = new Set(getAllPermissions());
    const arrays = [...seedSql.matchAll(/ARRAY\[([\s\S]*?)\]::TEXT\[\]/g)].map(
      (m) => m[1],
    );
    expect(arrays).toHaveLength(6);
    const unknown: string[] = [];
    let total = 0;
    for (const body of arrays) {
      const keys = [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(10);
      total += keys.length;
      for (const key of keys) {
        if (!known.has(key)) unknown.push(key);
      }
      // No duplicates inside one preset.
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(unknown).toEqual([]);
    expect(total).toBeGreaterThan(120);
  });

  it('no seeded preset carries the dangerous reconciliation key', () => {
    expect(seedSql).not.toContain('run_stock_reconciliation');
    expect(seedSql).not.toContain('manage_presets');
    expect(seedSql).not.toContain('manage_license');
  });
});
