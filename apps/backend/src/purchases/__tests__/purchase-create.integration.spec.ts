/**
 * Real-DB purchase-create smoke — the CI gap behind the FixedPlus outage.
 *
 * All purchase-create tests before this file were mocked unit tests: they
 * prove call order/shape only. They cannot catch a missing enum TYPE on a
 * real database — exactly what broke live purchase creation (Postgres 42704
 * `type "public.PurchaseStatus" does not exist`, wrapped by Prisma as P2039).
 *
 * Runs against a REAL database (NOT mocked Prisma), following the existing
 * `.integration.spec.ts` convention: the CI unit job excludes `integration`
 * specs (`--testPathIgnorePatterns "integration"`), so this runs with a live
 * DATABASE_URL (local scratch Postgres, or the ephemeral-Postgres gate)
 * instead of in the mocked unit suite.
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/<scratch-db> \
 *     npx jest src/purchases/__tests__/purchase-create.integration.spec.ts
 *
 * The drift test deliberately breaks the schema (drops the enum type) and
 * repairs it again; it always re-applies the corrective migration in a
 * `finally` so the database is left healthy even when an assertion fails.
 * Run it against a SCRATCH database only — never production.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient, PurchaseStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

jest.setTimeout(60000);

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/ecomate_web';
const pool = new Pool({ connectionString, max: 5 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const REPAIR_MIGRATION_SQL = fs.readFileSync(
  path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'prisma',
    'migrations',
    '20261124220000_purchase_status_enum_repair',
    'migration.sql',
  ),
  'utf8',
);

// Pre-repair for the above (20261124215959): drops a blocking TEXT default
// on "Purchase"."status" so the repair migration's ALTER COLUMN TYPE can
// run. Applied first, in deploy order, wherever the repair is applied.
const PRE_REPAIR_MIGRATION_SQL = fs.readFileSync(
  path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'prisma',
    'migrations',
    '20261124215959_purchase_status_default_repair',
    'migration.sql',
  ),
  'utf8',
);

const EXPECTED_ENUM_LABELS = [
  'draft',
  'ordered',
  'partially_received',
  'received',
  'cancelled',
];

/** The exact transaction shape of PurchasesService.create(). */
async function createPurchaseViaServiceShape(
  txSupplierId: string,
  txProductId: string,
) {
  return prisma.$transaction(async (tx) => {
    const now = new Date(Date.now() + 6 * 60 * 60 * 1000);
    const yy = String(now.getUTCFullYear()).slice(2);
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const counter = await tx.purchaseCounter.upsert({
      where: { date: `${yy}${mm}${dd}` },
      create: { date: `${yy}${mm}${dd}`, seq: 1 },
      update: { seq: { increment: 1 } },
    });
    const poNumber = `PO-${yy}${mm}${dd}-${String(counter.seq).padStart(4, '0')}`;
    const purchase = await tx.purchase.create({
      data: {
        supplierId: txSupplierId,
        referenceNo: poNumber,
        orderDate: new Date(),
        status: PurchaseStatus.ordered,
        subtotal: 100,
        taxAmount: 0,
        discount: 0,
        total: 100,
        paidAmount: 0,
        items: {
          create: [
            {
              productId: txProductId,
              quantity: 2,
              unitPrice: 50,
              totalPrice: 100,
              totalBill: 100,
              receivedQty: 0,
            },
          ],
        },
      },
      include: { supplier: true, items: true },
    });
    await tx.purchaseEvent.create({
      data: {
        purchaseId: purchase.id,
        type: 'created',
        message: `Purchase order ${poNumber} created`,
        data: {},
      },
    });
    return purchase;
  });
}

describe('purchase create — real-DB smoke (FixedPlus 42704 / P2039)', () => {
  let supplierId: string;
  let productId: string;
  const purchaseIds: string[] = [];
  const stamp = Date.now();

  beforeAll(async () => {
    supplierId = (
      await prisma.supplier.create({
        data: { name: 'Smoke Supplier', slug: `smoke-supplier-${stamp}` },
      })
    ).id;
    productId = (
      await prisma.product.create({
        data: {
          name: 'Smoke Product',
          slug: `smoke-product-${stamp}`,
          basePrice: 50,
        },
      })
    ).id;
  });

  afterAll(async () => {
    // Leave the database healthy even if the drift test failed midway.
    try {
      const [{ exists }] = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PurchaseStatus') AS exists
      `;
      if (!exists) {
        // Pre-repair first: on a text column WITH a default the repair
        // alone fails with 42804 (see the with-default drift test below).
        await pool.query(PRE_REPAIR_MIGRATION_SQL);
        await pool.query(REPAIR_MIGRATION_SQL);
      }
    } catch {
      // Best-effort repair only; the assertions above already reported.
    }
    if (purchaseIds.length > 0) {
      await prisma.purchaseEvent.deleteMany({
        where: { purchaseId: { in: purchaseIds } },
      });
      await prisma.purchaseItem.deleteMany({
        where: { purchaseId: { in: purchaseIds } },
      });
      await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
    }
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.$disconnect();
    await pool.end();
  });

  it('PurchaseStatus enum exists with the five schema values', async () => {
    const rows = await prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'PurchaseStatus'
      ORDER BY e.enumsortorder
    `;
    expect(rows.map((r) => r.enumlabel)).toEqual(EXPECTED_ENUM_LABELS);
  });

  it('purchase create succeeds on a real DB (counter + create + event)', async () => {
    const created = await createPurchaseViaServiceShape(supplierId, productId);
    purchaseIds.push(created.id);
    expect(created.referenceNo).toMatch(/^PO-\d{6}-\d{4}$/);
    expect(created.status).toBe('ordered');
    expect(created.items).toHaveLength(1);
    expect(created.items[0].productId).toBe(productId);
    const persisted = await prisma.purchase.findUnique({
      where: { id: created.id },
      include: { items: true },
    });
    expect(persisted?.status).toBe('ordered');
  });

  it('corrective migration is idempotent: applying it twice is a no-op', async () => {
    await pool.query(REPAIR_MIGRATION_SQL);
    await pool.query(REPAIR_MIGRATION_SQL);
    const created = await createPurchaseViaServiceShape(supplierId, productId);
    purchaseIds.push(created.id);
    expect(created.status).toBe('ordered');
    const [{ udt_name: colType, column_default: colDefault }] =
      await prisma.$queryRaw<{ udt_name: string; column_default: string }[]>`
        SELECT udt_name, column_default FROM information_schema.columns
        WHERE table_name = 'Purchase' AND column_name = 'status'
      `;
    expect(colType).toBe('PurchaseStatus');
    expect(colDefault).toContain('draft');
  });

  it('drift repair: missing enum fails with P2039/42704, migration fixes it', async () => {
    try {
      // Recreate the FixedPlus drift: type gone, column back to text.
      await pool.query(
        'ALTER TABLE "Purchase" ALTER COLUMN "status" DROP DEFAULT',
      );
      await pool.query(
        'ALTER TABLE "Purchase" ALTER COLUMN "status" TYPE text USING "status"::text',
      );
      await pool.query('DROP TYPE "PurchaseStatus"');

      // The exact live failure: purchase.create() -> 42704 wrapped as P2039.
      let failure: any;
      try {
        await createPurchaseViaServiceShape(supplierId, productId);
      } catch (e) {
        failure = e;
      }
      expect(failure).toBeDefined();
      expect(failure.code).toBe('P2039');
      expect(JSON.stringify(failure.meta)).toContain('42704');
      const cause = (failure.meta as any)?.driverAdapterError?.cause;
      expect(cause?.originalCode).toBe('42704');
      expect(cause?.originalMessage).toBe(
        'type "public.PurchaseStatus" does not exist',
      );

      // The corrective migration repairs the drift through the normal path.
      await pool.query(REPAIR_MIGRATION_SQL);

      const created = await createPurchaseViaServiceShape(supplierId, productId);
      purchaseIds.push(created.id);
      expect(created.status).toBe('ordered');
    } finally {
      // Always leave the database healthy, even on assertion failure.
      await pool.query(REPAIR_MIGRATION_SQL);
    }
  });

  it('drift WITH a text default: repair alone fails 42804, pre-repair + repair fixes it', async () => {
    try {
      // The exact FixedPlus state the first round MISSED: text column WITH
      // a TEXT default ('draft'::text), enum type gone. That round's
      // scratch repro used a text column with NO default, so the repair
      // migration's ALTER succeeded there and the 42804 was never seen —
      // until the live redeploy crash-looped on it (P3018).
      await pool.query(
        'ALTER TABLE "Purchase" ALTER COLUMN "status" DROP DEFAULT',
      );
      await pool.query(
        'ALTER TABLE "Purchase" ALTER COLUMN "status" TYPE text USING "status"::text',
      );
      await pool.query(
        `ALTER TABLE "Purchase" ALTER COLUMN "status" SET DEFAULT 'draft'::text`,
      );
      await pool.query('DROP TYPE "PurchaseStatus"');

      const [{ column_default: driftDefault, udt_name: driftType }] =
        await prisma.$queryRaw<{ udt_name: string; column_default: string }[]>`
          SELECT udt_name, column_default FROM information_schema.columns
          WHERE table_name = 'Purchase' AND column_name = 'status'
        `;
      expect(driftType).toBe('text');
      expect(driftDefault).toContain('draft');

      // Purchase create fails the same way as live (42704 / P2039).
      let failure: any;
      try {
        await createPurchaseViaServiceShape(supplierId, productId);
      } catch (e) {
        failure = e;
      }
      expect(failure).toBeDefined();
      expect(failure.code).toBe('P2039');
      expect(JSON.stringify(failure.meta)).toContain('42704');

      // THE REGRESSION: the repair migration ALONE cannot fix this state —
      // Postgres refuses ALTER COLUMN TYPE while a text default exists.
      let repairFailure: any;
      try {
        await pool.query(REPAIR_MIGRATION_SQL);
      } catch (e) {
        repairFailure = e;
      }
      expect(repairFailure).toBeDefined();
      expect(
        String(
          (repairFailure as any)?.code ?? repairFailure?.message ?? '',
        ),
      ).toContain('42804');

      // Pre-repair (drop the blocking default) + repair, in deploy order.
      await pool.query(PRE_REPAIR_MIGRATION_SQL);
      await pool.query(REPAIR_MIGRATION_SQL);

      const created = await createPurchaseViaServiceShape(supplierId, productId);
      purchaseIds.push(created.id);
      expect(created.status).toBe('ordered');
      const [{ udt_name: colType, column_default: colDefault }] =
        await prisma.$queryRaw<{ udt_name: string; column_default: string }[]>`
          SELECT udt_name, column_default FROM information_schema.columns
          WHERE table_name = 'Purchase' AND column_name = 'status'
        `;
      expect(colType).toBe('PurchaseStatus');
      expect(colDefault).toContain('draft');
    } finally {
      // Always leave the database healthy, even on assertion failure:
      // pre-repair first, otherwise the repair alone fails on this state.
      await pool.query(PRE_REPAIR_MIGRATION_SQL);
      await pool.query(REPAIR_MIGRATION_SQL);
    }
  });
});
