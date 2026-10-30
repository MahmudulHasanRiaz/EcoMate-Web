/**
 * One-time stock-reconciliation tool (hardened 2026-10-30, directive §2.4).
 *
 * This REPLACES the old heal-on-demand script. It NEVER blanket-heals:
 *   - DRY-RUN is the default: prints the finder report (R1–R5 rows +
 *     counts and the Q1–Q8 verification set) and writes nothing.
 *   - --apply writes, and ONLY the finder's still-R1/R2 rows, through the
 *     same guarded ReconciliationApplyService the admin page uses.
 *   - --apply REQUIRES --client=<stack> (informational scope label,
 *     recorded on the ReconciliationRun audit record). The database is
 *     whatever DATABASE_URL points at — the operator MUST confirm it
 *     matches the named stack before applying.
 *   - REFUSES to run at all while STOCK_RECONCILE_ON_BOOT=true is present
 *     in the environment (the removed auto-heal must not race a manual run
 *     during the transition).
 *
 * Live-run preconditions (directive §6, OWNER's steps): restore-tested
 * backup taken immediately before, dry-run reviewed + signed off, flag
 * off on the target stack, ONE client per run (avelto first, then
 * fxdmostul). After --apply, re-run the dry-run: zero R1/R2 rows is the
 * required proof — if it is not zero, restore from backup, do NOT
 * re-apply.
 *
 * Usage:
 *   cd apps/backend
 *   npx tsx prisma/scripts/reconcile-stock.ts [--client=<stack>]
 *   npx tsx prisma/scripts/reconcile-stock.ts --apply --client=<stack> [--backup=<dump-id>]
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { ReconciliationFinderService } from '../../src/reconciliation/reconciliation-finder.service';
import { ReconciliationApplyService } from '../../src/reconciliation/reconciliation-apply.service';
import type { ReconReport } from '../../src/reconciliation/reconciliation-finder.service';

function printReport(report: ReconReport): void {
  console.log(
    `[reconcile] report generatedAt=${report.generatedAt} imEnabled=${report.imEnabled}`,
  );
  console.log(
    `[reconcile] counts R1=${report.counts.R1} R2=${report.counts.R2} ` +
      `R3=${report.counts.R3} R4=${report.counts.R4} ` +
      `R5=${JSON.stringify(report.counts.R5)}`,
  );
  for (const r of report.rows) {
    console.log(
      `  [${r.category}] order=${r.orderDisplayId} return=${r.returnDisplayId ?? '-'} ` +
        `product=${r.productName} variant=${r.variantId ?? '-'} layer=${r.layer} ` +
        `ordered=${r.orderedQty} good=${r.receivedGoodQty} damaged=${r.damagedQty} ` +
        `restoredManaged=${r.alreadyRestoredManaged} restoredPhysical=${r.alreadyRestoredPhysical} ` +
        `missingManaged=${r.missingManagedQty} missingPhysical=${r.missingPhysicalQty}`,
    );
    console.log(`      evidence: ${r.evidence}`);
  }
  for (const c of report.checks) {
    console.log(
      `  [${c.key}] ${c.label} = ${c.value} ` +
        `(pass=${c.pass === null ? 'info' : c.pass}) — ${c.detail}`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const clientArg = args.find((a) => a.startsWith('--client='));
  const client = clientArg ? clientArg.split('=')[1] : null;
  const backupArg = args.find((a) => a.startsWith('--backup='));
  const backupId = backupArg ? backupArg.split('=')[1] : null;

  if (process.env['STOCK_RECONCILE_ON_BOOT'] === 'true') {
    console.error(
      '[reconcile] REFUSED: STOCK_RECONCILE_ON_BOOT=true is present in the ' +
        'environment. Remove the flag from the stack env first (auto-heal was ' +
        'removed 2026-10-30; a leftover flag must not race a manual run).',
    );
    process.exit(1);
  }
  if (apply && !client) {
    console.error(
      '[reconcile] REFUSED: --apply requires --client=<stack> so the run is ' +
        'recorded against the stack it was meant for.',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const finder = app.get(ReconciliationFinderService);

    if (!apply) {
      console.log(
        '[reconcile] DRY RUN — no stock will be changed.' +
          (client ? ` Scope label: client=${client}.` : '') +
          ' Reminder: the database is whatever DATABASE_URL points at' +
          (client ? ` — confirm it matches the "${client}" stack.` : '.'),
      );
      printReport(await finder.buildReport());
      return;
    }

    console.log(
      `[reconcile] APPLY for client=${client}. DATABASE_URL must point at the ` +
        `"${client}" stack — if it does not, STOP NOW. A restore-tested backup ` +
        'must already exist (directive §6).',
    );
    const report = await finder.buildReport();
    printReport(report);
    const targets = report.rows.filter(
      (r) => r.category === 'R1' || r.category === 'R2',
    );
    if (targets.length === 0) {
      console.log('[reconcile] Nothing to apply — zero R1/R2 rows.');
      return;
    }
    const applyService = app.get(ReconciliationApplyService);
    const result = await applyService.apply({
      performedBy: `reconcile-script:${client}`,
      backupId,
      rowIds: targets.map((r) => r.id),
      clientLabel: client,
    });
    console.log(
      `[reconcile] run=${result.runId} applied=${result.applied.length} ` +
        `skipped=${result.skipped.length}`,
    );
    for (const s of result.skipped) {
      console.log(`  skipped ${s.id}: ${s.reason}`);
    }
    console.log(
      `[reconcile] idempotency ok=${result.idempotency.ok} ` +
        `remainingR1R2=${result.idempotency.remainingR1R2}`,
    );
    if (!result.idempotency.ok) {
      console.error(
        '[reconcile] IDEMPOTENCY FAILED — an applied row still shows missing ' +
          'stock in the post-run report. Do NOT re-apply; restore from backup ' +
          'and investigate (directive §6).',
      );
      process.exitCode = 2;
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error('[reconcile] FAILED:', err);
    process.exit(1);
  });
