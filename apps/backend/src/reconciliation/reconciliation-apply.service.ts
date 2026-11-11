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
import {
  orderItemsSnapshotForClient,
  resolveReceivedById,
} from '../returns/return-guard';
import { dhakaDateParts } from '../common/utils/dhaka-time';

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
 *
 * R6 (2026-11-11, stock-mode round §5) is applied through this same
 * per-row transaction pattern: re-validated inside the transaction
 * (product still INVENTORY_CONTROLLED, quantity/residue still present),
 * then healed exactly the way products.service performs a mode switch —
 * a ManagedStockLedger type='ADJUSTMENT' entry in the
 * 'Mode changed from MANAGED_STOCK to INVENTORY_CONTROLLED' wording
 * family (stockBefore → 0, performedById = the caller) plus the managed
 * quantity zeroed on the product/variant row. StockService.operate is
 * deliberately NOT used: it is a delta primitive keyed to order/return
 * references and cannot express set-to-zero for a negative stranded
 * quantity. The heal entry becomes the unit's last mode-change entry
 * with nothing after it, so the finder's residue key goes clean.
 *
 * R7 is explicitly REFUSED here even when listed in rowIds: suspected
 * legacy mirror copies are report-only, human disposition only.
 *
 * R8 (2026-11-11, owner decision) backfills the missing Return record
 * for legacy pre-Return-system orders, re-classifying the order inside
 * the transaction with the finder's shared classifier:
 *   terminal — creates the Return as RESTOCKED + stockReconciled with
 *     receivedAt = the historical 'Returned' transition date. The
 *     restore is an ALREADY-DONE fact: NO stock quantity is written.
 *     Coverage is recorded with the REAL RECEIVE PATH's keying —
 *     per-return keys `return-<returnId>` (managed: ManagedStockLedger
 *     type='RETURN', referenceType='RETURN', referenceId=
 *     `return-<returnId>`, direction='IN'; physical:
 *     PhysicalInventoryLedger type='RESTORATION', reason=
 *     `return-<returnId>`, direction='IN') — NEVER the blanket path's
 *     order keying (`return-<orderId>`), so the finder sums the
 *     backfilled return as fully restored and no path can restore it a
 *     second time. Each coverage entry carries stockBefore ==
 *     stockAfter (the current quantity): it is an evidence record of a
 *     historical movement, not a movement. Physical coverage is written
 *     only where a warehouse is evidenced by the order line (the frozen
 *     sourceWarehouseId / product warehouse, exactly as the receive
 *     path freezes it) AND a PhysicalInventory row exists there — a
 *     warehouse is never invented.
 *   pending — creates the Return as REQUESTED only. It is NEVER marked
 *     received: receiving is always a manual employee act; staff
 *     receive the backfilled record through the normal Process return
 *     / Mark received flow, which restores stock then — once.
 *   R8-H rows (ambiguous evidence) are explicitly REFUSED here.
 * RTN numbering follows generateReturnDisplayId's pattern (ReturnCounter
 * upsert) but on the HISTORICAL transition date, with a displayId
 * uniqueness probe + retry, so a backfilled RTN-YYMMDD-NNNN can never
 * collide with a real return numbered on that day.
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
  idempotency: {
    ok: boolean;
    remainingR1R2: number;
    remainingR6: number;
    remainingR8: number;
  };
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
        if (row.category === 'R8' && row.r8Kind === 'human') {
          // Explicit refusal: ambiguous legacy evidence is report-only
          // (R8-H) — a date or quantity is never fabricated to force a
          // backfill through.
          skipped.push({
            id: rowId,
            reason:
              'Category R8-H is REPORT-ONLY — the legacy evidence for this ' +
              'order is ambiguous; human disposition required.',
          });
          continue;
        }
        if (row.category === 'R7') {
          // Explicit refusal, not the generic fall-through: R7 rows are
          // suspected legacy mirror copies and are NEVER auto-applied,
          // even when an operator lists them under --apply.
          skipped.push({
            id: rowId,
            reason:
              'Category R7 is REPORT-ONLY — suspected legacy mirror copies are ' +
              'never auto-applied; human disposition required.',
          });
          continue;
        }
        if (
          row.category !== 'R1' &&
          row.category !== 'R2' &&
          row.category !== 'R6' &&
          row.category !== 'R8'
        ) {
          skipped.push({
            id: rowId,
            reason: `Category ${row.category} is never applied (report-only / human disposition).`,
          });
          continue;
        }
        try {
          const outcome =
            row.category === 'R6'
              ? await this.applyR6Row(row, input.performedBy)
              : row.category === 'R8'
                ? await this.applyR8Row(row, input.performedBy)
                : await this.applyRow(row, input.performedBy);
          if (outcome.applied) applied.push(rowId);
          else skipped.push({ id: rowId, reason: outcome.reason });
        } catch (err) {
          skipped.push({ id: rowId, reason: (err as Error).message });
        }
      }

      const post = await this.finder.buildReport();
      const remainingR1R2 = post.counts.R1 + post.counts.R2;
      const remainingR6 = post.counts.R6 ?? 0;
      const remainingR8 = post.counts.R8 ?? 0;
      const appliedStillMissing = post.rows.filter(
        (r) =>
          applied.includes(r.id) &&
          (r.missingManagedQty > 0 ||
            r.missingPhysicalQty > 0 ||
            // An applied R6 row still present in the post-run report is
            // by definition still stranded / still carrying residue;
            // an applied R8 row still present means the Return record
            // was not created (or its evidence re-classified it R8-H).
            r.category === 'R6' ||
            r.category === 'R8'),
      );
      const idempotency = {
        ok: appliedStillMissing.length === 0,
        remainingR1R2,
        remainingR6,
        remainingR8,
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
   * RTN-YYMMDD-NNNN on a HISTORICAL date — the generateReturnDisplayId
   * pattern (ReturnCounter upsert, tx-safe) re-pointed at the legacy
   * transition date, plus a uniqueness probe: if the candidate number
   * already exists (a real return numbered that day), the counter
   * advances and the next candidate is probed, so a backfill can never
   * collide with — or renumber — an existing return.
   */
  private async generateBackfillDisplayId(
    tx: Prisma.TransactionClient,
    date: Date,
  ): Promise<string> {
    const { year, month, day } = dhakaDateParts(date);
    const dateStr =
      `${String(year).slice(2)}${String(month).padStart(2, '0')}` +
      `${String(day).padStart(2, '0')}`;
    for (let attempt = 0; attempt < 50; attempt++) {
      const counter = await (tx as any).returnCounter.upsert({
        where: { date: dateStr },
        create: { date: dateStr, seq: 1 },
        update: { seq: { increment: 1 } },
      });
      const candidate = `RTN-${dateStr}-${String(counter.seq).padStart(4, '0')}`;
      const existing = await tx.return.findFirst({
        where: { displayId: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
    }
    throw new Error(
      `Could not allocate a unique RTN number for ${dateStr} after 50 attempts`,
    );
  }

  /**
   * One R8 row, one transaction. Re-classifies the order from its
   * CURRENT timeline inside the transaction (the report may be stale)
   * and re-checks the idempotency key (no Return row for the order).
   * Creates the Return record — and, for terminal rows only, the
   * per-return evidence entries — with NO stock quantity writes.
   */
  private async applyR8Row(
    row: ReconRow,
    performedBy: string,
  ): Promise<{ applied: true } | { applied: false; reason: string }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.return.findFirst({
        where: { orderId: row.orderId },
        select: { id: true },
      });
      if (existing) {
        return {
          applied: false,
          reason: 'A Return record now exists for this order — already normalized.',
        };
      }
      const order = await tx.order.findUnique({
        where: { id: row.orderId },
        select: {
          id: true,
          displayId: true,
          timeline: true,
          status: { select: { name: true } },
        },
      });
      if (!order) return { applied: false, reason: 'Order no longer exists.' };
      const cls = this.finder.classifyLegacyReturn({
        statusName: (order.status as any)?.name ?? '',
        timeline: order.timeline,
      });
      if (cls.kind === 'human') {
        return {
          applied: false,
          reason: `Evidence is ambiguous (R8-H): ${cls.reason}`,
        };
      }
      const items = await orderItemsSnapshotForClient(tx, row.orderId);
      if (items.length === 0) {
        return {
          applied: false,
          reason: 'Order has no lines — returned quantities are unknowable (R8-H).',
        };
      }
      const backfillActor = `reconcile-backfill:${performedBy}`;
      const actorEmail =
        cls.actor && cls.actor.includes('@') ? cls.actor : null;
      // createdBy names the historical staff actor when the timeline
      // recorded one; otherwise the clearly-marked backfill actor.
      const createdBy = actorEmail ?? backfillActor;

      if (cls.kind === 'pending') {
        const displayId = await this.generateBackfillDisplayId(tx, cls.pendingAt!);
        await tx.return.create({
          data: {
            orderId: row.orderId,
            displayId,
            type: 'FULL',
            status: 'REQUESTED',
            items: items as unknown as Prisma.InputJsonValue,
            source: 'STAFF',
            createdBy,
            reason:
              'Legacy return backfilled by stock reconciliation — this order ' +
              'predates the Return system and was left Return Pending. Staff ' +
              'receive it via the normal Process return / Mark received flow.',
            stockReconciled: false,
            createdAt: cls.pendingAt!,
          },
        });
        return { applied: true };
      }

      // ── terminal: the return already happened under the legacy flow ──
      const returnedAt = cls.returnedAt!;
      const displayId = await this.generateBackfillDisplayId(tx, returnedAt);
      // receivedById mirrors the receive path exactly: the historical
      // actor resolved to a UserProfile id when they were staff;
      // automated/unknown actors stay NULL (the schema's documented
      // state for pre-existing received rows — never "system").
      const receivedById = await resolveReceivedById(tx as any, actorEmail);
      // Freeze each item's origin warehouse exactly as the receive path
      // does (order line sourceWarehouseId, else the product default).
      const orderLines = await tx.orderItem.findMany({
        where: { orderId: row.orderId },
        select: {
          productId: true,
          variantId: true,
          sourceWarehouseId: true,
          product: { select: { warehouseId: true } },
        },
      });
      const warehouseByKey = new Map<string, string>();
      for (const line of orderLines as any[]) {
        const key = `${line.productId}|${line.variantId ?? ''}`;
        const wh = line.sourceWarehouseId ?? line.product?.warehouseId ?? null;
        if (wh && !warehouseByKey.has(key)) warehouseByKey.set(key, wh);
      }
      const frozenItems = items.map((it) => {
        const wh = warehouseByKey.get(`${it.productId}|${it.variantId ?? ''}`);
        return wh ? { ...it, warehouseId: wh } : it;
      });

      const created = await tx.return.create({
        data: {
          orderId: row.orderId,
          displayId,
          type: 'FULL',
          status: 'RESTOCKED',
          items: frozenItems as unknown as Prisma.InputJsonValue,
          source: 'STAFF',
          createdBy,
          reason:
            'Legacy return backfilled by stock reconciliation — this order ' +
            'predates the Return system; its stock restore was effected by ' +
            'the legacy flow and is recorded here as already-done evidence ' +
            '(per-return keys, stockBefore = stockAfter, NO stock movement).',
          stockReconciled: true,
          stockReconciledAt: returnedAt,
          receivedAt: returnedAt,
          receivedById,
          createdAt: cls.pendingAt ?? returnedAt,
        },
      });

      // Coverage entries — the real receive path's PER-RETURN keying
      // (`return-<returnId>`), quantities = the restored good units,
      // stockBefore == stockAfter == current quantity (evidence only).
      const reference = `return-${created.id}`;
      const imEnabled = await this.finder.isInventoryManagementEnabled();
      const productIds = [...new Set(items.map((i) => i.productId))];
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, availabilityMode: true, manageStock: true },
      });
      const productById = new Map(products.map((p) => [p.id, p]));
      for (const it of frozenItems) {
        if (!it.quantity || it.quantity <= 0) continue;
        const product = productById.get(it.productId);
        const mode = (product?.availabilityMode as string) ?? 'MANAGED_STOCK';
        const managedExpected =
          mode === 'MANAGED_STOCK' && product?.manageStock !== false;
        if (managedExpected) {
          const current = it.variantId
            ? ((
                await tx.productVariant.findUnique({
                  where: { id: it.variantId },
                  select: { managedStockQuantity: true },
                })
              )?.managedStockQuantity ?? 0)
            : ((
                await tx.product.findUnique({
                  where: { id: it.productId },
                  select: { managedStockQuantity: true },
                })
              )?.managedStockQuantity ?? 0);
          await tx.managedStockLedger.create({
            data: {
              productId: it.productId,
              variantId: it.variantId ?? null,
              quantity: it.quantity,
              direction: 'IN',
              type: 'RETURN',
              stockBefore: current,
              stockAfter: current,
              referenceType: 'RETURN',
              referenceId: reference,
              note:
                'Legacy return backfill — restore already effected by the ' +
                'pre-Return-system flow; evidence entry only, no stock movement.',
              performedById: backfillActor,
              performedAt: returnedAt,
            },
          });
        }
        const physicalExpected =
          imEnabled && (mode === 'MANAGED_STOCK' || mode === 'INVENTORY_CONTROLLED');
        const warehouseId = (it as any).warehouseId as string | undefined;
        if (physicalExpected && warehouseId) {
          const pi = await tx.physicalInventory.findFirst({
            where: {
              productId: it.productId,
              variantId: it.variantId ?? null,
              warehouseId,
            },
            select: { quantity: true, reservedQuantity: true },
          });
          if (pi) {
            await tx.physicalInventoryLedger.create({
              data: {
                productId: it.productId,
                variantId: it.variantId ?? null,
                warehouseId,
                quantity: it.quantity,
                direction: 'IN',
                stockBefore: pi.quantity,
                stockAfter: pi.quantity,
                reservedBefore: pi.reservedQuantity,
                reservedAfter: pi.reservedQuantity,
                type: 'RESTORATION',
                reason: reference,
                performedBy: backfillActor,
              },
            });
          }
        }
      }
      return { applied: true };
    });
  }

  /**
   * One R6 row, one transaction. Recomputes the stranded quantity and
   * the ledger residue from CURRENT records inside the transaction;
   * writes nothing when the unit is already clean (a concurrent mode
   * fix / heal may have landed first). The write mirrors
   * products.service's own mode-switch cleanup: ManagedStockLedger
   * ADJUSTMENT entry (stockBefore → 0) in the mode-change wording
   * family, then the managed quantity zeroed. A negative stranded
   * quantity is cleared as an IN movement of its magnitude — never
   * flipped silently, never left stranded. NO physical record is ever
   * written here: the layers are independent since the mirror removal.
   */
  private async applyR6Row(
    row: ReconRow,
    performedBy: string,
  ): Promise<{ applied: true } | { applied: false; reason: string }> {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: row.productId },
        select: { availabilityMode: true, type: true, managedStockQuantity: true },
      });
      if (!product) return { applied: false, reason: 'Product no longer exists.' };
      if (product.availabilityMode !== 'INVENTORY_CONTROLLED') {
        return {
          applied: false,
          reason:
            `Product availabilityMode is now ${product.availabilityMode} — ` +
            'no longer INVENTORY_CONTROLLED, nothing to heal.',
        };
      }

      let qty: number;
      if (row.variantId) {
        const variant = await tx.productVariant.findUnique({
          where: { id: row.variantId },
          select: { managedStockQuantity: true },
        });
        if (!variant) return { applied: false, reason: 'Variant no longer exists.' };
        qty = variant.managedStockQuantity;
      } else {
        qty = product.managedStockQuantity;
      }

      const residue = await this.finder.managedModeResidue(
        row.productId,
        row.variantId,
        tx,
      );
      if (qty === 0 && !residue.residue) {
        return {
          applied: false,
          reason:
            'Already healed — managed quantity is 0 and no mode-switch ' +
            'ledger residue remains.',
        };
      }

      const note = row.variantId
        ? `Mode changed from MANAGED_STOCK to INVENTORY_CONTROLLED — variant snapshot: ${qty} units`
        : `Mode changed from MANAGED_STOCK to INVENTORY_CONTROLLED — snapshot: ${qty} units`;
      await tx.managedStockLedger.create({
        data: {
          productId: row.productId,
          variantId: row.variantId,
          quantity: Math.abs(qty),
          direction: qty < 0 ? 'IN' : 'OUT',
          type: 'ADJUSTMENT',
          stockBefore: qty,
          stockAfter: 0,
          note,
          performedById: performedBy,
        },
      });
      if (qty !== 0) {
        if (row.variantId) {
          await tx.productVariant.update({
            where: { id: row.variantId },
            data: { managedStockQuantity: 0 },
          });
        } else {
          await tx.product.update({
            where: { id: row.productId },
            data: { managedStockQuantity: 0 },
          });
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
