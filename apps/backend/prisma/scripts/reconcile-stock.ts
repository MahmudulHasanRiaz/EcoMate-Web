/**
 * Manual stock reconciliation / healing script.
 *
 * Heals orders whose stock state drifted from their order status (the historical
 * courier-webhook deduction bug). Idempotent — safe to re-run.
 *
 * Usage:
 *   cd apps/backend
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
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const reconcile = app.get(StockReconciliationService);

  const orderArg = process.argv.find((a) => a.startsWith('--order='));
  if (orderArg) {
    const orderId = orderArg.split('=')[1];
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