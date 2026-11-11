/**
 * One-time stock-reconciliation tool (hardened 2026-10-30, directive §2.4).
 *
 * This REPLACES the old heal-on-demand script. It NEVER blanket-heals:
 *   - DRY-RUN is the default: prints the finder report (R1–R7 rows +
 *     counts and the Q1–Q8 verification set) and writes nothing.
 *   - --apply writes, and ONLY the finder's still-R1/R2/R6/R8 rows,
 *     through the same guarded ReconciliationApplyService the admin
 *     page uses. R6 (2026-11-11) heals managed quantities stranded on
 *     INVENTORY_CONTROLLED products by an uncleaned mode switch; R8
 *     (2026-11-11) backfills the missing Return record for legacy
 *     pre-Return-system orders (terminal rows move NO stock — evidence
 *     entries only; pending rows are created REQUESTED, never
 *     received). R7 (suspected legacy mirror copies) and R8-H
 *     (ambiguous legacy evidence) are REPORT-ONLY and are never passed
 *     to Apply — the service refuses them explicitly as well.
 *   - --apply REQUIRES --client=<stack> (informational scope label,
 *     recorded on the ReconciliationRun audit record), --backup=<dump-id>
 *     naming the restore-tested backup taken immediately before, and an
 *     explicit --confirm flag. The service re-enforces backup + confirmed
 *     server-side, so these flags are the operator's deliberate act, not
 *     a formality. The database is whatever DATABASE_URL points at — the
 *     operator MUST confirm it matches the named stack before applying.
 *   - REFUSES to run at all while STOCK_RECONCILE_ON_BOOT=true is present
 *     in the environment (the removed auto-heal must not race a manual run
 *     during the transition).
 *
 * Live-run preconditions (directive §6, OWNER's steps): restore-tested
 * backup taken immediately before, dry-run reviewed + signed off, flag
 * off on the target stack, ONE client per run (avelto first, then
 * fxdmostul). After --apply, re-run the dry-run: zero R1/R2/R6/R8 rows
 * is the required proof — if it is not zero, restore from backup, do
 * NOT re-apply. (R7 and R8-H rows may remain — report-only by design.)
 *
 * Usage:
 *   cd apps/backend
 *   npx tsx prisma/scripts/reconcile-stock.ts [--client=<stack>]
 *   npx tsx prisma/scripts/reconcile-stock.ts --apply --client=<stack> --backup=<dump-id> --confirm
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
      `R5=${JSON.stringify(report.counts.R5)} ` +
      `R6=${report.counts.R6 ?? 0} R7=${report.counts.R7 ?? 0} ` +
      `R8=${report.counts.R8 ?? 0} R8H=${report.counts.R8H ?? 0}`,
  );
  for (const r of report.rows) {
    console.log(
      `  [${r.category}] order=${r.orderDisplayId} return=${r.returnDisplayId ?? '-'} ` +
        `product=${r.productName} variant=${r.variantId ?? '-'} layer=${r.layer} ` +
        `ordered=${r.orderedQty} good=${r.receivedGoodQty} damaged=${r.damagedQty} ` +
        `restoredManaged=${r.alreadyRestoredManaged} restoredPhysical=${r.alreadyRestoredPhysical} ` +
        `missingManaged=${r.missingManagedQty} missingPhysical=${r.missingPhysicalQty}` +
        (r.strandedManagedQty !== undefined
          ? ` strandedManaged=${r.strandedManagedQty}`
          : '') +
        (r.physicalQty !== undefined
          ? ` physicalQty=${r.physicalQty} warehouse=${r.warehouseId ?? '-'}`
          : '') +
        (r.r8Kind !== undefined
          ? ` r8Kind=${r.r8Kind} legacyAt=${r.legacyAt ?? '-'} legacyActor=${r.legacyActor ?? '-'}`
          : ''),
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
  const confirm = args.includes('--confirm');
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
  if (apply && (!backupId || !backupId.trim())) {
    console.error(
      '[reconcile] REFUSED: --apply requires --backup=<dump-id> naming the ' +
        'restore-tested backup taken immediately before the run.',
    );
    process.exit(1);
  }
  if (apply && !confirm) {
    console.error(
      '[reconcile] REFUSED: --apply requires --confirm — review the dry-run ' +
        'report first, then re-run with --confirm to apply.',
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
    // R7 and R8-H are deliberately NOT targets: report-only, human
    // disposition. (R8 rows carry r8Kind — only terminal/pending rows
    // are backfillable.)
    const targets = report.rows.filter(
      (r) =>
        r.category === 'R1' ||
        r.category === 'R2' ||
        r.category === 'R6' ||
        (r.category === 'R8' && r.r8Kind !== 'human'),
    );
    if (targets.length === 0) {
      console.log('[reconcile] Nothing to apply — zero R1/R2/R6/R8 rows.');
      return;
    }
    const applyService = app.get(ReconciliationApplyService);
    const result = await applyService.apply({
      performedBy: `reconcile-script:${client}`,
      backupId,
      confirmed: confirm,
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
        `remainingR1R2=${result.idempotency.remainingR1R2} ` +
        `remainingR6=${result.idempotency.remainingR6 ?? 0} ` +
        `remainingR8=${result.idempotency.remainingR8 ?? 0}`,
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
