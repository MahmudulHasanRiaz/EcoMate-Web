import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { CostingLotService } from '../stock/costing-lot.service';
import {
  ReconciliationFinderService,
  RECEIVED_RETURN_STATUSES,
  ReconCheck,
  ReconRow,
} from './reconciliation-finder.service';

/**
 * Stock-reconciliation APPLY (2026-10-30 directive §2.8).
 *
 * Writes ONLY rows the finder still classifies R1/R2 at apply time, each in
 * its own transaction, re-validating the ledger evidence INSIDE the
 * transaction before writing. The writes use the same primitives the
 * receive path uses:
 *   managed  — StockService.operate('add', ledgerType RETURN,
 *              referenceType RETURN, reference `return-<returnId>`)
 *   physical — restore into the order's own reservation ALLOCATION rows
 *              (guarded PhysicalInventory increments + release of the held
 *              reservedQuantity for the restored portion) +
 *              PhysicalInventoryLedger RESTORATION rows with reason
 *              `return-<returnId>`, plus CostingLotService.restoreForReturn
 *              where FULFILLMENT consumptions exist
 * so an applied row is indistinguishable from a receive-path restore and
 * the post-run finder re-run sees the matching ledger add (idempotency).
 *
 * The service itself enforces the §2.8 gates (restore-tested backupId +
 * confirmed === true) — callers (admin controller, CLI script) validate
 * too, but the write path never trusts them. The physical leg NEVER
 * invents a warehouse: with no reservation allocation to restore into,
 * the physical part is skipped as not-applicable.
 *
 * NEVER blanket healAll() — that would also heal R3 + orphan releases,
 * which are out of scope here. R3 is report-only; R4 is never applied.
 */

export interface ReconcileApplyInput {
  performedBy: string;
  backupId?: string | null;
  /** Must be exactly true — enforced here, not only by callers. */
  confirmed?: boolean;
  rowIds: string[];
  /** Informational scope label for script runs (e.g. the --client value). */
  clientLabel?: string | null;
}

export interface ReconcileApplyResult {
  runId: string;
  applied: string[];
  skipped: { id: string; reason: string }[];
  checks: ReconCheck[];
  idempotency: { ok: boolean; remainingR1R2: number };
}

/** A RUNNING record older than this is a crashed run, not a concurrent one. */
const RUNNING_STALE_MS = 30 * 60 * 1000;

@Injectable()
export class ReconciliationApplyService {
  private readonly logger = new Logger(ReconciliationApplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly finder: ReconciliationFinderService,
    private readonly stockService: StockService,
    private readonly costingLotService: CostingLotService,
  ) {}

  async apply(input: ReconcileApplyInput): Promise<ReconcileApplyResult> {
    // §2.8 gates enforced HERE, in the write path itself — the admin
    // controller and the CLI script validate too, but a caller that skips
    // its own validation must still not get a write through.
    if (!input.backupId || !input.backupId.trim()) {
      throw new BadRequestException(
        'Apply requires the id of a restore-tested backup taken immediately before the run.',
      );
    }
    if (input.confirmed !== true) {
      throw new BadRequestException(
        'Apply requires confirmed=true — preview the report and confirm first.',
      );
    }
    if (process.env['STOCK_RECONCILE_ON_BOOT'] === 'true') {
      throw new BadRequestException(
        'STOCK_RECONCILE_ON_BOOT=true is present in the environment — refusing ' +
          'to apply while the (removed) auto-heal flag is still set. Remove the ' +
          'flag from the stack environment first.',
      );
    }

    // Concurrency: the stale sweep + RUNNING check + run create run inside
    // ONE transaction holding a transaction-scoped advisory lock, so two
    // simultaneous applies cannot both pass the check (the old
    // check-then-create outside a lock let both through).
    const run = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7272, 6301)`;
      const staleBefore = new Date(Date.now() - RUNNING_STALE_MS);
      await tx.reconciliationRun.updateMany({
        where: { status: 'RUNNING', createdAt: { lt: staleBefore } },
        data: { status: 'FAILED', finishedAt: new Date() },
      });
      const running = await tx.reconciliationRun.findFirst({
        where: { status: 'RUNNING' },
        select: { id: true },
      });
      if (running) {
        throw new ConflictException(
          'Another reconciliation Apply is already RUNNING — wait for it to finish.',
        );
      }
      return tx.reconciliationRun.create({
        data: {
          performedBy: input.performedBy,
          backupId: input.backupId ?? null,
          status: 'RUNNING',
        },
      });
    });

    const applied: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    try {
      const report = await this.finder.buildReport();
      const byId = new Map(report.rows.map((r) => [r.id, r]));
      for (const rowId of input.rowIds) {
        const row = byId.get(rowId);
        if (!row) {
          skipped.push({
            id: rowId,
            reason: 'No longer qualifies — not present in the fresh report.',
          });
          continue;
        }
        if (row.category !== 'R1' && row.category !== 'R2') {
          skipped.push({
            id: rowId,
            reason: `Category ${row.category} is never applied (report-only / human disposition).`,
          });
          continue;
        }
        try {
          const outcome = await this.applyRow(row, input.performedBy);
          if (outcome.applied) applied.push(rowId);
          else skipped.push({ id: rowId, reason: outcome.reason });
        } catch (err) {
          skipped.push({ id: rowId, reason: (err as Error).message });
        }
      }

      const post = await this.finder.buildReport();
      const remainingR1R2 = post.counts.R1 + post.counts.R2;
      const appliedStillMissing = post.rows.filter(
        (r) =>
          applied.includes(r.id) &&
          (r.missingManagedQty > 0 || r.missingPhysicalQty > 0),
      );
      const idempotency = {
        ok: appliedStillMissing.length === 0,
        remainingR1R2,
      };

      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          appliedCount: applied.length,
          skippedCount: skipped.length,
          finishedAt: new Date(),
          result: {
            applied,
            skipped,
            checks: post.checks,
            idempotency,
            clientLabel: input.clientLabel ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return { runId: run.id, applied, skipped, checks: post.checks, idempotency };
    } catch (err) {
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          appliedCount: applied.length,
          skippedCount: skipped.length,
          finishedAt: new Date(),
          result: {
            applied,
            skipped,
            error: (err as Error).message,
            clientLabel: input.clientLabel ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      throw err;
    }
  }

  /**
   * One row, one transaction. Recomputes the missing quantities from the
   * CURRENT records inside the transaction; writes nothing when the ledger
   * already covers the return (a concurrent receive may have healed it).
   */
  private async applyRow(
    row: ReconRow,
    performedBy: string,
  ): Promise<{ applied: true } | { applied: false; reason: string }> {
    if (!row.returnId) {
      return { applied: false, reason: 'Row has no Return record to restore against.' };
    }
    const returnId = row.returnId;
    return this.prisma.$transaction(async (tx) => {
      const ret = await tx.return.findUnique({
        where: { id: returnId },
        select: { id: true, orderId: true, items: true, status: true },
      });
      if (!ret) return { applied: false, reason: 'Return record no longer exists.' };
      // Re-validate the return is STILL in a received state at apply time —
      // the report may be stale (return re-opened / deleted since preview).
      if (
        !(RECEIVED_RETURN_STATUSES as readonly string[]).includes(ret.status)
      ) {
        return {
          applied: false,
          reason: `Return status is now ${ret.status} — only RECEIVED/RESTOCKED/CLOSED returns are restored.`,
        };
      }
      const item = ((ret.items as any[]) ?? []).find(
        (i) => i?.productId === row.productId && (i?.variantId ?? null) === row.variantId,
      );
      if (!item || typeof item.quantity !== 'number') {
        return { applied: false, reason: 'Return item quantity is no longer recorded.' };
      }
      const good = Math.max(0, item.quantity - (item.damagedQuantity ?? 0));
      if (good <= 0) return { applied: false, reason: 'No good quantity to restore.' };

      const product = await tx.product.findUnique({
        where: { id: row.productId },
        select: { availabilityMode: true, warehouseId: true, manageStock: true },
      });
      if (!product) return { applied: false, reason: 'Product no longer exists.' };
      const mode = product.availabilityMode as string;

      // Ordered quantity caps every restore (a return can never restore
      // more than the order line sold).
      const order = await tx.order.findUnique({
        where: { id: ret.orderId },
        select: {
          items: { select: { productId: true, variantId: true, quantity: true } },
        },
      });
      const orderedQty =
        order?.items.find(
          (li) => li.productId === row.productId && (li.variantId ?? null) === row.variantId,
        )?.quantity ?? good;

      // Evidence includes BOTH key shapes: the per-return adds AND the
      // blanket restore path's order-keyed adds — a blanket-restored return
      // must never be restored a second time from here.
      const [managedMap, physicalMap, managedBlanket, physicalBlanket] =
        await Promise.all([
          this.finder.managedRestoredByReturn([returnId], tx),
          this.finder.physicalRestoredByReturn([returnId], tx),
          this.finder.managedRestoredByOrder([ret.orderId], tx),
          this.finder.physicalRestoredByOrder([ret.orderId], tx),
        ]);
      const key = `return-${returnId}|${row.productId}|${row.variantId ?? ''}`;
      const blanketKey = `return-${ret.orderId}|${row.productId}|${row.variantId ?? ''}`;
      const restoredManaged =
        (managedMap.get(key) ?? 0) + (managedBlanket.get(blanketKey) ?? 0);
      const restoredPhysical =
        (physicalMap.get(key) ?? 0) + (physicalBlanket.get(blanketKey) ?? 0);

      const missingManaged =
        mode === 'MANAGED_STOCK' && product.manageStock !== false
          ? Math.min(Math.max(0, good - restoredManaged), orderedQty)
          : 0;
      // Physical expectation mirrors the finder: only when the row says a
      // physical layer is missing (the row was produced under IM-on rules).
      const missingPhysical =
        row.missingPhysicalQty > 0
          ? Math.min(Math.max(0, good - restoredPhysical), orderedQty)
          : 0;

      if (missingManaged <= 0 && missingPhysical <= 0) {
        return {
          applied: false,
          reason: 'Already restored — the matching ledger add now exists.',
        };
      }

      let wroteManaged = false;
      if (missingManaged > 0) {
        await this.stockService.operate('add', {
          productId: row.productId,
          variantId: row.variantId ?? undefined,
          quantity: missingManaged,
          reference: `return-${returnId}`,
          performedBy,
          tx,
          ledgerType: 'RETURN',
          referenceType: 'RETURN',
        });
        wroteManaged = true;
      }

      if (missingPhysical > 0) {
        const outcome = await this.restorePhysicalIntoAllocations(tx, {
          orderId: ret.orderId,
          returnId,
          productId: row.productId,
          variantId: row.variantId,
          quantity: missingPhysical,
          performedBy,
        });
        if (outcome.restored < missingPhysical) {
          const partialNote = wroteManaged
            ? 'Managed layer restored. '
            : outcome.restored > 0
              ? `Physical layer partially restored (${outcome.restored}/${missingPhysical}). `
              : '';
          return {
            applied: false,
            reason:
              partialNote +
              (outcome.restored === 0
                ? 'No reservation allocation exists to restore the physical layer into — NOT written (a warehouse is never invented).'
                : 'Remaining physical quantity has no allocation target — NOT written (a warehouse is never invented).'),
          };
        }
      }

      return { applied: true };
    });
  }

  /**
   * The physical leg: restore into the order's OWN reservation allocation
   * rows — the exact PhysicalInventory rows the stock was deducted from.
   * Both reservation tables are consulted; only CONSUMED / RESTORED
   * reservations are targets (an ACTIVE hold means the stock never left;
   * a RELEASED one was already settled). When no allocation target
   * exists the caller skips the row as not-applicable — a warehouse is
   * NEVER invented (the old resolver fell back to the product warehouse,
   * any existing row, or the stack default, fabricating stock location).
   *
   * Per allocation: guarded quantity increment, release of the held
   * reservedQuantity for the restored portion (guarded decrement — the
   * Return-Pending re-hold), and a RESTORATION ledger row carrying the
   * row's true before/after. Costing lots are restored per warehouse via
   * CostingLotService.restoreForReturn where FULFILLMENT consumptions
   * exist for that warehouse.
   */
  private async restorePhysicalIntoAllocations(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      returnId: string;
      productId: string;
      variantId: string | null;
      quantity: number;
      performedBy: string;
    },
  ): Promise<{ restored: number }> {
    const [standalone, combo] = await Promise.all([
      tx.physicalReservation.findMany({
        where: {
          orderId: params.orderId,
          productId: params.productId,
          variantId: params.variantId,
          status: { in: ['CONSUMED', 'RESTORED'] },
        },
        select: {
          allocations: { select: { physicalInventoryId: true, quantity: true } },
        },
      }),
      tx.comboComponentPhysicalReservation.findMany({
        where: {
          orderId: params.orderId,
          productId: params.productId,
          variantId: params.variantId,
          status: { in: ['CONSUMED', 'RESTORED'] },
        },
        select: {
          allocations: { select: { physicalInventoryId: true, quantity: true } },
        },
      }),
    ]);
    const allocations = [...standalone, ...combo].flatMap((r) => r.allocations);
    if (allocations.length === 0) return { restored: 0 };

    // Distribute the restore across allocations, capped per allocation at
    // what that allocation originally held (merged per inventory row, so
    // each row gets one increment + one ledger entry).
    const planByRow = new Map<string, number>();
    let remaining = params.quantity;
    for (const a of allocations) {
      if (remaining <= 0) break;
      const n = Math.min(remaining, a.quantity);
      if (n <= 0) continue;
      planByRow.set(
        a.physicalInventoryId,
        (planByRow.get(a.physicalInventoryId) ?? 0) + n,
      );
      remaining -= n;
    }
    const plan = [...planByRow.entries()].map(([physicalInventoryId, quantity]) => ({
      physicalInventoryId,
      quantity,
    }));
    if (plan.length === 0) return { restored: 0 };

    // Costing lots first, grouped per warehouse: if a warehouse's lots
    // cannot cover its portion, restoreForReturn throws and the whole row
    // transaction rolls back (skip with reason) instead of leaving the
    // physical and cost layers diverged.
    const restoredByWarehouse = new Map<string, number>();
    const piRows = new Map<
      string,
      { quantity: number; reservedQuantity: number; warehouseId: string }
    >();
    for (const step of plan) {
      const pi = await tx.physicalInventory.findUnique({
        where: { id: step.physicalInventoryId },
        select: { quantity: true, reservedQuantity: true, warehouseId: true },
      });
      if (!pi) continue;
      piRows.set(step.physicalInventoryId, pi);
      restoredByWarehouse.set(
        pi.warehouseId,
        (restoredByWarehouse.get(pi.warehouseId) ?? 0) + step.quantity,
      );
    }
    if (piRows.size === 0) return { restored: 0 };

    for (const [warehouseId, qty] of restoredByWarehouse) {
      const consumption = await tx.costingLotConsumption.findFirst({
        where: {
          type: 'FULFILLMENT',
          referenceType: 'ORDER_ITEM',
          costingLot: {
            productId: params.productId,
            variantId: params.variantId,
            warehouseId,
          },
        },
        select: { id: true },
      });
      if (consumption) {
        await this.costingLotService.restoreForReturn({
          returnReferenceId: params.returnId,
          productId: params.productId,
          variantId: params.variantId,
          warehouseId,
          returnQty: qty,
          tx,
        });
      }
    }

    let restored = 0;
    for (const step of plan) {
      const pi = piRows.get(step.physicalInventoryId);
      if (!pi) continue;
      const n = step.quantity;
      await tx.physicalInventory.update({
        where: { id: step.physicalInventoryId },
        data: { quantity: { increment: n } },
      });
      // Release the held reservedQuantity for the restored portion — the
      // same guarded decrement the receive path's restore uses; a no-op
      // when the row does not currently hold that much.
      const released = await tx.physicalInventory.updateMany({
        where: {
          id: step.physicalInventoryId,
          reservedQuantity: { gte: n },
        },
        data: { reservedQuantity: { decrement: n } },
      });
      const reservedAfter =
        released.count > 0 ? pi.reservedQuantity - n : pi.reservedQuantity;
      await tx.physicalInventoryLedger.create({
        data: {
          productId: params.productId,
          variantId: params.variantId,
          warehouseId: pi.warehouseId,
          quantity: n,
          direction: 'IN',
          stockBefore: pi.quantity,
          stockAfter: pi.quantity + n,
          reservedBefore: pi.reservedQuantity,
          reservedAfter,
          type: 'RESTORATION',
          reason: `return-${params.returnId}`,
          performedBy: params.performedBy,
        },
      });
      restored += n;
    }
    return { restored };
  }
}
