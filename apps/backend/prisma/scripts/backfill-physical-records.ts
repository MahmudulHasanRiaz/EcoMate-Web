/**
 * One-time backfill: PhysicalInventory records for legacy MANAGED_STOCK
 * products (owner decision 2026-10-23, Q9 — strict scoping).
 *
 * Before the B4 fix, product create/import set the managed counter without
 * creating the physical record, so those products can be ordered but never
 * confirmed while Inventory Management is on. This script seeds the missing
 * physical records from the managed counter, through the SAME
 * InitialPhysicalStockService the create/import paths use (INITIAL ledger).
 *
 * Scope — deliberately narrow, per the owner's ruling:
 *   - NO-OP unless the Inventory Management feature is enabled on THIS
 *     database (systemSetting inventory_enabled = 'true'). Clients without
 *     the feature have no physical layer — a missing record there is
 *     normal, not a gap.
 *   - MANAGED_STOCK products with manageStock on, created on/after
 *     --since=<YYYY-MM-DD> (the date IM was enabled for this client —
 *     required, never guessed).
 *   - Only units whose physical record is genuinely MISSING at the
 *     product's warehouse. Existing records are never topped up, so the
 *     script is idempotent and safe to re-run.
 *   - Drafts are excluded (they are seeded when published).
 *
 * Usage:
 *   cd apps/backend
 *   # DRY RUN (default — writes nothing):
 *   npx tsx prisma/scripts/backfill-physical-records.ts --since=2026-01-01
 *   # apply:
 *   npx tsx prisma/scripts/backfill-physical-records.ts --since=2026-01-01 --apply
 *
 * Run the dry run on staging first and review the output before --apply,
 * and before using it on any client database.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StockRouterService } from '../../src/stock/stock-router.service';
import { InitialPhysicalStockService } from '../../src/stock/initial-physical-stock.service';

async function main() {
  const apply = process.argv.includes('--apply');
  const sinceArg = process.argv.find((a) => a.startsWith('--since='));
  if (!sinceArg) {
    console.error(
      '[backfill] --since=<YYYY-MM-DD> is required: the date Inventory ' +
        'Management was enabled for this client. Only products created on ' +
        'or after that date are in scope (owner Q9 scoping).',
    );
    process.exit(1);
  }
  const since = new Date(`${sinceArg.split('=')[1]}T00:00:00.000Z`);
  if (Number.isNaN(since.getTime())) {
    console.error('[backfill] --since must be a valid YYYY-MM-DD date.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const prisma = app.get(PrismaService);
  const stockRouter = app.get(StockRouterService);
  const initialPhysical = app.get(InitialPhysicalStockService);

  const imEnabled = await stockRouter.isInventoryManagementEnabled();
  if (!imEnabled) {
    console.log(
      '[backfill] Inventory Management is NOT enabled on this database — ' +
        'no-op (physical records are not part of this client\'s setup).',
    );
    await app.close();
    return;
  }

  const products = await prisma.product.findMany({
    where: {
      availabilityMode: 'MANAGED_STOCK',
      manageStock: true,
      status: { not: 'draft' },
      createdAt: { gte: since },
    },
    select: {
      id: true,
      name: true,
      type: true,
      warehouseId: true,
      managedStockQuantity: true,
      variants: {
        select: { id: true, managedStockQuantity: true, sku: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(
    `[backfill] ${apply ? 'APPLY' : 'DRY RUN'} — ${products.length} managed-mode ` +
      `product(s) created since ${since.toISOString().slice(0, 10)}.`,
  );

  let seededProducts = 0;
  let seededUnits = 0;
  let skippedExisting = 0;
  let blocked = 0;

  for (const product of products) {
    const units =
      product.type === 'variable'
        ? product.variants.map((v) => ({
            variantId: v.id as string | null,
            quantity: v.managedStockQuantity ?? 0,
            label: v.sku ?? v.id,
          }))
        : [
            {
              variantId: null as string | null,
              quantity: product.managedStockQuantity ?? 0,
              label: product.name,
            },
          ];

    const stocked = units.filter((u) => u.quantity > 0);
    if (stocked.length === 0) continue;

    // Resolve the warehouse the same way product create does.
    let warehouseId: string | null = product.warehouseId;
    if (!warehouseId) {
      try {
        warehouseId = await initialPhysical.resolveWarehouse(
          'MANAGED_STOCK',
          stocked[0].quantity,
          null,
        );
      } catch (e) {
        blocked++;
        console.log(
          `  BLOCKED ${product.name} (${product.id}): ${(e as Error).message}`,
        );
        continue;
      }
    }
    if (!warehouseId) continue;

    const missing: typeof stocked = [];
    for (const unit of stocked) {
      const existing = await prisma.physicalInventory.findFirst({
        where: {
          productId: product.id,
          variantId: unit.variantId,
          warehouseId,
          binLocationId: null,
        },
        select: { id: true },
      });
      if (existing) {
        skippedExisting++;
      } else {
        missing.push(unit);
      }
    }
    if (missing.length === 0) continue;

    for (const unit of missing) {
      console.log(
        `  ${apply ? 'SEED' : 'WOULD SEED'} ${product.name} · ${unit.label}: ` +
          `+${unit.quantity} @ warehouse ${warehouseId}`,
      );
      seededUnits += unit.quantity;
    }
    seededProducts++;

    if (apply) {
      await initialPhysical.mirrorUnits({
        productId: product.id,
        productWarehouseId: product.warehouseId,
        warehouseId,
        units: missing.map((u) => ({
          variantId: u.variantId ?? undefined,
          quantity: u.quantity,
        })),
        reference: 'backfill-physical-records (Q9)',
        performedBy: 'backfill-script',
      });
    }
  }

  console.log(
    `[backfill] done — products ${apply ? 'seeded' : 'to seed'}: ${seededProducts}, ` +
      `units: ${seededUnits}, units skipped (record exists): ${skippedExisting}, ` +
      `blocked: ${blocked}.`,
  );
  if (!apply) {
    console.log('[backfill] DRY RUN — nothing was written. Re-run with --apply to seed.');
  }

  await app.close();
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('[backfill] FAILED:', err);
    process.exit(1);
  });
