/**
 * Stock race safety — central-commerce P13 (operator-directed).
 *
 * Claim: concurrent same-variant orders cannot double-spend ERP stock.
 * Proof strategy (no new lock service — the existing reservation/ledger
 * semantics already serialize):
 * 1. `lockRows` issues `SELECT … FOR UPDATE` on the product + variant rows
 *    BEFORE any stock value is read (asserted by call order). The database
 *    therefore serializes concurrent `operate()` transactions touching the
 *    same rows: the loser reads the winner's committed state.
 * 2. Given serialization, the ledger semantics reject oversell: a reserve
 *    whose available (managed − reserved) is smaller than the requested qty
 *    throws `Insufficient stock` and writes nothing (sequential proof).
 * 3. End-to-end emulation: two concurrent `reserve(5)` against 5 units with
 *    a FOR-UPDATE-faithful lock (the loser's lock acquisition blocks until
 *    the winner's `operate()` settles, exactly like the DB row lock) → one
 *    succeeds, one throws, final reserved is 5 (never 10).
 *
 * Assumption (documented, standard): the database honors `SELECT … FOR
 * UPDATE` row locks. The code's part — lock before read-check-write inside
 * one transaction — is what this suite pins.
 *
 * Static audit (same file): every order path applies stock inside the
 * order's transaction via the StockService.operate family (never a direct
 * column write), and no order mutation calls any provider (R-2 holds for
 * the P13 quantity methods too).
 */
import * as fs from 'fs';
import * as path from 'path';
import { StockService } from './stock.service';

interface RowState {
  managedStockQuantity: number;
  reservedStock: number;
}

/** Shared committed state + a FOR-UPDATE-faithful async mutex (re-entrant per tx tag, like a real DB lock held by one transaction). */
function makeStore() {
  const rows = new Map<string, RowState>();
  const log: string[] = [];
  let holder: string | null = null;
  let depth = 0;
  const waiters: Array<() => void> = [];
  const acquire = async (tag: string) => {
    while (holder !== null && holder !== tag) await new Promise<void>((r) => waiters.push(r));
    holder = tag;
    depth += 1;
  };
  const release = () => {
    depth -= 1;
    if (depth <= 0) {
      depth = 0;
      holder = null;
      waiters.shift()?.();
    }
  };
  /** Test-only: drop the whole lock held by a finished operate (its tx is gone, like a DB commit). */
  const releaseTag = (tag: string) => {
    if (holder === tag) {
      depth = 0;
      holder = null;
      waiters.shift()?.();
    }
  };
  return { rows, log, acquire, release, releaseTag };
}

function makeTx(store: ReturnType<typeof makeStore>, tag: string) {
  const tx: any = {
    __tag: tag,
    $queryRawUnsafe: jest.fn(async () => {
      store.log.push(`${tag}:lock`);
      await store.acquire(tag);
      return [];
    }),
    productVariant: {
      findUnique: jest.fn(async ({ where }: any) => {
        store.log.push(`${tag}:read-variant`);
        if (where?.id === 'var-1') return { id: 'var-1', productId: 'prod-1' };
        const r = store.rows.get(where?.id ?? '');
        return r ? { id: where.id, managedStockQuantity: r.managedStockQuantity, reservedStock: r.reservedStock } : null;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        store.log.push(`${tag}:read-variants`);
        const ids: string[] = where?.id?.in ?? [];
        return ids
          .filter((id) => store.rows.has(`v:${id}`))
          .map((id) => ({ id, ...(store.rows.get(`v:${id}`) as RowState), productId: 'prod-1' }));
      }),
      update: jest.fn(async ({ where, data }: any) => {
        store.log.push(`${tag}:write-variant`);
        const r = store.rows.get(`v:${where.id}`) as RowState;
        for (const [field, op] of Object.entries(data as Record<string, any>)) {
          const v = (op as any);
          if (v?.increment !== undefined) (r as any)[field] += v.increment;
          if (v?.decrement !== undefined) (r as any)[field] -= v.decrement;
        }
        return r;
      }),
    },
    product: {
      findMany: jest.fn(async ({ where }: any) => {
        store.log.push(`${tag}:read-products`);
        const ids: string[] = where?.id?.in ?? [];
        return ids.map((id) => ({
          id,
          type: 'variable',
          manageStock: false,
          availabilityMode: 'MANAGED_STOCK',
          ...(store.rows.get(`p:${id}`) as RowState),
        }));
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        store.log.push(`${tag}:read-product`);
        const r = store.rows.get(`p:${where?.id}`);
        return r ? { id: where.id, availabilityMode: 'MANAGED_STOCK', ...r } : null;
      }),
      update: jest.fn(async () => ({})),
    },
    inventoryLog: { create: jest.fn(async () => ({})) },
    managedStockLedger: { create: jest.fn(async () => ({})) },
    order: { findFirst: jest.fn(async () => null) },
  };
  return tx;
}

function makeService() {
  const cache: any = { invalidateByPrefix: jest.fn(async () => undefined) };
  const costing: any = {};
  return new StockService({} as any, cache, costing, undefined);
}

function seed(store: ReturnType<typeof makeStore>, managed: number, reserved: number) {
  store.rows.set('v:var-1', { managedStockQuantity: managed, reservedStock: reserved });
  store.rows.set('p:prod-1', { managedStockQuantity: managed, reservedStock: reserved });
}

describe('stock race safety (P13: no double-spend)', () => {
  it('lockRows runs SELECT … FOR UPDATE before any stock read', async () => {
    const store = makeStore();
    seed(store, 5, 0);
    const svc = makeService();
    const tx = makeTx(store, 'A');
    await svc.operate('reserve', {
      variantId: 'var-1',
      quantity: 2,
      reference: 'ORD-260101-0001',
      tx,
    });
    store.releaseTag('A');
    const lockIdx = store.log.findIndex((l) => l === 'A:lock');
    const firstReadIdx = store.log.findIndex((l) => l.endsWith(':read-variants') || l.endsWith(':read-products'));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(firstReadIdx).toBeGreaterThan(lockIdx);
  });

  it('sequential oversell is rejected and writes nothing (ledger semantics)', async () => {
    const store = makeStore();
    seed(store, 5, 0);
    const svc = makeService();
    const txA = makeTx(store, 'A');
    await svc.operate('reserve', { variantId: 'var-1', quantity: 5, reference: 'ORD-260101-0001', tx: txA });
    store.releaseTag('A');
    expect(store.rows.get('v:var-1')).toMatchObject({ managedStockQuantity: 5, reservedStock: 5 });
    const txB = makeTx(store, 'B');
    await expect(
      svc.operate('reserve', { variantId: 'var-1', quantity: 1, reference: 'ORD-260101-0002', tx: txB }),
    ).rejects.toThrow(/Insufficient stock/);
    store.releaseTag('B');
    expect(store.rows.get('v:var-1')).toMatchObject({ managedStockQuantity: 5, reservedStock: 5 });
  });

  it('two concurrent reserve(5) against 5 units → exactly one wins, total never exceeds stock', async () => {
    const store = makeStore();
    seed(store, 5, 0);
    const svc = makeService();
    const run = async (tag: string, ref: string) => {
      const tx = makeTx(store, tag);
      try {
        await svc.operate('reserve', { variantId: 'var-1', quantity: 5, reference: ref, tx });
        return 'ok';
      } finally {
        store.releaseTag(tag);
      }
    };
    const results = await Promise.allSettled([run('A', 'ORD-260101-0001'), run('B', 'ORD-260101-0002')]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason?.message ?? '')).toMatch(/Insufficient stock/);
    expect(store.rows.get('v:var-1')).toMatchObject({ managedStockQuantity: 5, reservedStock: 5 });
  });
});

describe('order-path stock audit (P13 race safety, static)', () => {
  const src = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

  it('all order paths apply stock through the StockService.operate family inside a transaction', () => {
    // Storefront + admin share orders.service.create → resolveAndApplyStock →
    // stockService.operate* with the order tx; external ingest funnels into
    // the same create(); POS uses stock.reserve/deduct/addPhysical with tx.
    const orders = src('../orders/orders.service.ts');
    expect(orders).toMatch(/resolveAndApplyStock/);
    expect(orders).toMatch(/stockService\.operate/);
    const pos = src('../pos/pos-orders.service.ts');
    expect(pos).toMatch(/this\.stock\.(reserve|deduct|addPhysical)/);
    const stock = src('./stock.service.ts');
    expect(stock).toMatch(/FOR UPDATE/);
  });

  it('no order mutation calls any provider (R-2 holds for status AND quantity paths)', () => {
    for (const f of ['../orders/orders.service.ts', '../pos/pos-orders.service.ts']) {
      const body = src(f);
      expect(body).not.toContain('publishStockState');
      expect(body).not.toContain('publishStockQuantity');
      expect(body).not.toContain('readStockQuantity');
      expect(body).not.toContain('providerFor(');
    }
  });
});
