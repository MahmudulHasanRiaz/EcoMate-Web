/**
 * Manual stock reconciliation / healing script.
 *
 * Heals orders whose stock state drifted from their order status (the historical
 * courier-webhook deduction bug). Idempotent — safe to re-run.
 *
 * Usage:
 *   cd apps/backend
 *   # DRY RUN first — lists every order heal WOULD touch, writes nothing:
 *   npx tsx prisma/scripts/reconcile-stock.ts --dry-run
 *   # apply:
 *   npx tsx prisma/scripts/reconcile-stock.ts
 *   # target a single order:
 *   npx tsx prisma/scripts/reconcile-stock.ts --order=<orderId>
 *
 * Uses the Nest application context (no HTTP listener) so it runs the exact
 * same service logic as the deployed backend.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { StockReconciliationService } from '../../src/stock/stock-reconciliation.service';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const orderArg = process.argv.find((a) => a.startsWith('--order='));
  const orderId = orderArg ? orderArg.split('=')[1] : null;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const reconcile = app.get(StockReconciliationService);

  if (dryRun) {
    const candidates = await reconcile.scanDriftedOrders();
    const scoped = orderId
      ? candidates.filter((c) => c.id === orderId)
      : candidates;
    console.log(
      `[reconcile] DRY RUN — no stock will be changed. ` +
        `${scoped.length} order(s) would be healed${orderId ? ` (filtered to ${orderId})` : ''}:`,
    );
    for (const c of scoped) {
      console.log(`  - ${c.id} (status: ${c.statusName})`);
    }
    if (orderId && scoped.length === 0) {
      console.log(
        `[reconcile] order ${orderId} is not a drift candidate — heal would be a no-op for it.`,
      );
    }
    await app.close();
    return;
  }

  if (orderId) {
    const outcome = await reconcile.healOrder(orderId);
    console.log(`[reconcile] order ${orderId} → ${outcome}`);
  } else {
    const result = await reconcile.healAll();
    console.log(
      `[reconcile] scanned=${result.scanned} deducted=${result.deliveredDeducted} ` +
        `restored=${result.cancelledRestored} blocked=${result.blocked.length}`,
    );
    if (result.blocked.length > 0) {
      console.log('[reconcile] BLOCKED:');
      for (const b of result.blocked) console.log('  - ' + b);
    }
  }

  await app.close();
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('[reconcile] FAILED:', err);
    process.exit(1);
  });