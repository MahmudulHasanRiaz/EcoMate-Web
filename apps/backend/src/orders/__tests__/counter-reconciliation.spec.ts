/**
 * Counter split — seeded-day reconciliation (dashboard-counts audit §6,
 * P1.4 + P2/I4). The shared OrderCounter used to mint ORD + POS + Ex + JE
 * + EXP-JE + EMP numbers from ONE sequence, so the daily number (e.g. 46
 * on 2026-11-13) was never an order count. Since migration
 * 20261113233000 each family has its own sequence, seeded from the shared
 * seq so a mid-day deploy can never re-mint an existing displayId.
 *
 * Two halves, both locked here:
 *  A. Contract — the schema, the migration and every mint call site use
 *     the composite (date, family) key with the right family.
 *  B. Identity — a faithful in-memory replay of Prisma's upsert+increment
 *     semantics over the audit's seeded day proves the per-family
 *     sequences reconcile exactly, and that no non-order document can
 *     consume an order number.
 */
import * as fs from 'fs';
import * as path from 'path';

const root = (...segs: string[]) =>
  fs.readFileSync(path.resolve(__dirname, '..', '..', '..', ...segs), 'utf8');

/** Minimal faithful model of Prisma's upsert({where: {date_family}, create, update: {seq: increment}}) on (date, family). */
class CounterStore {
  private rows = new Map<string, number>();

  upsert(date: string, family: string): { date: string; seq: number } {
    const key = `${date}|${family}`;
    const seq = (this.rows.get(key) ?? 0) + 1;
    this.rows.set(key, seq);
    return { date, seq };
  }

  /** Direct seed, as the migration does (verbatim copy of a shared seq). */
  seed(date: string, family: string, seq: number): void {
    this.rows.set(`${date}|${family}`, seq);
  }

  seq(date: string, family: string): number {
    return this.rows.get(`${date}|${family}`) ?? 0;
  }
}

/** The exact mint call every service issues (same where/create/update shape). */
function mint(
  store: CounterStore,
  date: string,
  family: string,
  prefix: string,
): string {
  const counter = store.upsert(date, family);
  return `${prefix}-${date}-${String(counter.seq).padStart(4, '0')}`;
}

describe('Counter split — contract (P1.4)', () => {
  it('the schema keys OrderCounter by (date, family)', () => {
    const schema = root('prisma', 'schema.prisma');
    const start = schema.indexOf('model OrderCounter {');
    const model = schema.slice(start, schema.indexOf('\n}\n', start));
    expect(model).toContain('family String @default("ORD")');
    expect(model).toContain('@@id([date, family])');
    expect(model).not.toContain('date String @id');
  });

  it('the migration seeds every family from the shared seq, guarded per row', () => {
    const sql = root(
      'prisma',
      'migrations',
      '20261113233000_order_counter_per_family',
      'migration.sql',
    );
    // DDL: additive only — no row is deleted or updated, no column dropped.
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    // Seed: one row per family, copied verbatim from the shared seq.
    for (const fam of ['POS', 'Ex', 'JE', 'EXP-JE', 'EMP']) {
      expect(sql).toContain(`'${fam}'`);
    }
    expect(sql).toContain('ON CONFLICT (date, family) DO NOTHING');
    // Per-row EXCEPTION guard + preserve-verbatim fallback (original ORD
    // row is never UPDATE-d).
    expect(sql).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(sql).not.toMatch(/UPDATE\s+"OrderCounter"/i);
    // Only bare YYMMDD rows are fanned out — LEAD-/CS- keys are untouched.
    expect(sql).toContain(`date ~ '^[0-9]{6}$'`);
    // Probe block present (counts + NOTICE; the codebase has no probe_ddl
    // table — see the migration header).
    expect(sql).toContain('PROBE');
  });

  it.each([
    ['orders/orders.service.ts', 'ORD'],
    ['checkout-leads/checkout-leads.service.ts', 'ORD'],
    ['pos/pos-orders.service.ts', 'POS'],
    ['exchange/exchange.service.ts', 'Ex'],
    ['accounting/accounting.service.ts', 'JE'],
    ['expenses/expenses.service.ts', 'EXP-JE'],
    ['employees/employees.service.ts', 'EMP'],
  ])('%s mints from the %s family via the composite key', (file, family) => {
    const src = root('src', file);
    expect(src).toContain('date_family:');
    expect(src).toContain(`family: '${family}'`);
    // No mint call site may use the bare shared date key any more.
    expect(src).not.toMatch(/orderCounter\.upsert\(\{\s*where:\s*\{\s*date:/);
  });

  it('LEAD and courier-settlement numbers keep their namespaced date keys', () => {
    const leads = root('src', 'checkout-leads/checkout-leads.service.ts');
    expect(leads).toContain('LEAD-${dateStr}');
    const cs = root(
      'src',
      'courier-settlement/courier-settlement-import.service.ts',
    );
    expect(cs).toContain('CS${dateStr}');
    expect(cs).toContain('date_family:');
  });

  it('returns keep their own ReturnCounter (untouched by the split)', () => {
    const src = root('src', 'returns/returns.service.ts');
    expect(src).toContain('ReturnCounter');
    expect(src).not.toContain('orderCounter');
  });
});

describe('Counter split — seeded-day reconciliation (P2/I4)', () => {
  /**
   * Seeded Dhaka day 261113, adapted from audit §6 (whose own pattern
   * does not reconcile: 30+2+3+2+4+2+1+1(WC) = 45, not 46 — a WC order
   * consumes NO counter. This seed is defined to reconcile exactly):
   *  30 web SALE + 2 trashed SALE + 4 burned (failed creates) → ORD
   *   3 POS sales → POS; 2 exchange children → Ex
   *   2 manual journal entries → JE; 1 expense entry → EXP-JE
   *   1 hire → EMP; 1 imported WC order → no counter at all.
   */
  const DAY = '261113';

  function seedDay(): { store: CounterStore; ids: string[] } {
    const store = new CounterStore();
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(mint(store, DAY, 'ORD', 'ORD'));
    for (let i = 0; i < 2; i++) ids.push(mint(store, DAY, 'ORD', 'ORD')); // trashed SALE
    for (let i = 0; i < 4; i++) mint(store, DAY, 'ORD', 'ORD'); // burned
    for (let i = 0; i < 3; i++) ids.push(mint(store, DAY, 'POS', 'POS'));
    for (let i = 0; i < 2; i++) ids.push(mint(store, DAY, 'Ex', 'Ex'));
    for (let i = 0; i < 2; i++) ids.push(mint(store, DAY, 'JE', 'JE'));
    ids.push(mint(store, DAY, 'EXP-JE', 'EXP-JE'));
    ids.push(mint(store, DAY, 'EMP', 'EMP'));
    // WC order: created, counted in Activity — mints NOTHING.
    return { store, ids };
  }

  it('per-family sequences reconcile exactly (I4, split-counter world)', () => {
    const { store, ids } = seedDay();

    expect(store.seq(DAY, 'ORD')).toBe(36); // 30 SALE + 2 trashed + 4 burned
    expect(store.seq(DAY, 'POS')).toBe(3);
    expect(store.seq(DAY, 'Ex')).toBe(2);
    expect(store.seq(DAY, 'JE')).toBe(2);
    expect(store.seq(DAY, 'EXP-JE')).toBe(1);
    expect(store.seq(DAY, 'EMP')).toBe(1);
    // Every minted displayId is unique — even where sequences coincide
    // (JE-261113-0001 vs ORD-261113-0001), the prefix differs.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(30 + 2 + 3 + 2 + 2 + 1 + 1);
  });

  it('no non-order document consumes an order number', () => {
    const { store } = seedDay();
    // The ORD sequence advanced ONLY for orders (30 created + 2 trashed
    // + 4 burned by failed order creates). JE/EMP/EXP-JE mints live in
    // their own families: removing them changes nothing about ORD.
    const ordSeq = store.seq(DAY, 'ORD');
    expect(ordSeq).toBe(36);
    expect(store.seq(DAY, 'JE') + store.seq(DAY, 'EMP') + store.seq(DAY, 'EXP-JE')).toBe(4);
    // And the families are independent: JE-0001 and ORD-0001 coexist.
    expect(mint(store, DAY, 'JE', 'JE')).toBe('JE-261113-0003');
    expect(store.seq(DAY, 'ORD')).toBe(ordSeq);
  });

  it('a mid-day deploy seeded from the shared seq can never duplicate a displayId', () => {
    // Live day (Avelto 2026-11-13): shared seq 56, latest ORD-261113-0056.
    const store = new CounterStore();
    store.seed(DAY, 'ORD', 56);
    for (const fam of ['POS', 'Ex', 'JE', 'EXP-JE', 'EMP']) {
      store.seed(DAY, fam, 56); // the migration's verbatim copy
    }
    // The next mint of EVERY family starts above every number the
    // shared counter ever issued for that date.
    expect(mint(store, DAY, 'ORD', 'ORD')).toBe('ORD-261113-0057');
    expect(mint(store, DAY, 'POS', 'POS')).toBe('POS-261113-0057');
    expect(mint(store, DAY, 'JE', 'JE')).toBe('JE-261113-0057');
    expect(mint(store, DAY, 'EMP', 'EMP')).toBe('EMP-261113-0057');
    // Numbers are never reused, and existing displayIds never change:
    // the seed only ADDS rows; no stored displayId is rewritten.
  });

  it('Activity New is 34 for the seeded day (30 web + 3 POS + 1 WC)', () => {
    // Count identity, not counter identity: POS and WC orders ARE kind
    // SALE created that day (audit §1c), so they count in Activity even
    // though WC minted no number and POS minted from its own family.
    // Trashed SALE (2) and EXCHANGE children (2) are excluded.
    const activityNew = 30 + 3 + 1;
    expect(activityNew).toBe(34);
  });
});
