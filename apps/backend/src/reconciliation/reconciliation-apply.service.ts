import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { InitialPhysicalStockService } from '../stock/initial-physical-stock.service';
import {
  ReconciliationFinderService,
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
 *   physical — PhysicalInventory increment + PhysicalInventoryLedger
 *              RESTORATION row with reason `return-<returnId>`
 * so an applied row is indistinguishable from a receive-path restore and
 * the post-run finder re-run sees the matching ledger add (idempotency).
 *
 * NEVER blanket healAll() — that would also heal R3 + orphan releases,
 * which are out of scope here. R3 is report-only; R4 is never applied.
 */

export interface ReconcileApplyInput {
  performedBy: string;
  backupId?: string | null;
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
    private readonly initialPhysicalStock: InitialPhysicalStockService,
  ) {}

  async apply(input: ReconcileApplyInput): Promise<ReconcileApplyResult> {
    if (process.env['STOCK_RECONCILE_ON_BOOT'] === 'true') {
      throw new BadRequestException(
        'STOCK_RECONCILE_ON_BOOT=true is present in the environment — refusing ' +
          'to apply while the (removed) auto-heal flag is still set. Remove the ' +
          'flag from the stack environment first.',
      );
    }

    const staleBefore = new Date(Date.now() - RUNNING_STALE_MS);
    await this.prisma.reconciliationRun.updateMany({
      where: { status: 'RUNNING', createdAt: { lt: staleBefore } },
      data: { status: 'FAILED', finishedAt: new Date() },
    });
    const running = await this.prisma.reconciliationRun.findFirst({
      where: { status: 'RUNNING' },
      select: { id: true },
    });
    if (running) {
      throw new ConflictException(
        'Another reconciliation Apply is already RUNNING — wait for it to finish.',
      );
    }

    const run = await this.prisma.reconciliationRun.create({
      data: {
        performedBy: input.performedBy,
        backupId: input.backupId ?? null,
        status: 'RUNNING',
      },
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
        select: { availabilityMode: true, warehouseId: true },
      });
      if (!product) return { applied: false, reason: 'Product no longer exists.' };
      const mode = product.availabilityMode as string;

      const [managedMap, physicalMap] = await Promise.all([
        this.finder.managedRestoredByReturn([returnId], tx),
        this.finder.physicalRestoredByReturn([returnId], tx),
      ]);
      const key = `return-${returnId}|${row.productId}|${row.variantId ?? ''}`;
      const restoredManaged = managedMap.get(key) ?? 0;
      const restoredPhysical = physicalMap.get(key) ?? 0;

      const missingManaged =
        mode === 'MANAGED_STOCK' ? Math.max(0, good - restoredManaged) : 0;
      // Physical expectation mirrors the finder: only when the row says a
      // physical layer is missing (the row was produced under IM-on rules).
      const missingPhysical =
        row.missingPhysicalQty > 0 ? Math.max(0, good - restoredPhysical) : 0;

      if (missingManaged <= 0 && missingPhysical <= 0) {
        return {
          applied: false,
          reason: 'Already restored — the matching ledger add now exists.',
        };
      }

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
      }

      if (missingPhysical > 0) {
        const target = await this.resolvePhysicalTarget(tx, {
          orderId: ret.orderId,
          productId: row.productId,
          variantId: row.variantId,
          productWarehouseId: product.warehouseId,
          quantity: missingPhysical,
        });
        if (!target) {
          if (missingManaged > 0) {
            // Managed layer written; physical skipped — surface as skipped
            // with the managed part noted. (Throwing would roll back the
            // managed write too; a partial repair with a clear reason is
            // the safer outcome and the row stays in the next report.)
            return {
              applied: false,
              reason:
                'Managed layer restored, but no warehouse could be resolved ' +
                'for the physical layer — physical part NOT written.',
            };
          }
          return {
            applied: false,
            reason: 'No warehouse could be resolved for the physical restore.',
          };
        }
        const before = target.row.quantity;
        await tx.physicalInventory.update({
          where: { id: target.row.id },
          data: { quantity: before + missingPhysical },
        });
        await tx.physicalInventoryLedger.create({
          data: {
            productId: row.productId,
            variantId: row.variantId,
            warehouseId: target.row.warehouseId,
            quantity: missingPhysical,
            direction: 'IN',
            stockBefore: before,
            stockAfter: before + missingPhysical,
            type: 'RESTORATION',
            reason: `return-${returnId}`,
            performedBy,
          },
        });
      }

      return { applied: true };
    });
  }

  /**
   * Which PhysicalInventory row receives a physical restore, best evidence
   * first: (1) the exact row the order's reservation allocated from,
   * (2) warehouse-level row at the reservation's warehouse,
   * (3) the product's own warehouse, (4) an existing row for the product,
   * (5) the stack's default warehouse resolution. Creates the
   * warehouse-level row when the warehouse is known but no row exists.
   */
  private async resolvePhysicalTarget(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      productId: string;
      variantId: string | null;
      productWarehouseId: string | null;
      quantity: number;
    },
  ): Promise<{ row: { id: string; quantity: number; warehouseId: string } } | null> {
    const reservations = await tx.physicalReservation.findMany({
      where: {
        orderId: params.orderId,
        productId: params.productId,
        variantId: params.variantId,
      },
      select: {
        warehouseId: true,
        allocations: { select: { physicalInventoryId: true } },
      },
    });

    const warehouseLevel = async (warehouseId: string) => {
      const existing = await tx.physicalInventory.findFirst({
        where: {
          productId: params.productId,
          variantId: params.variantId,
          warehouseId,
          binLocationId: null,
        },
        select: { id: true, quantity: true, warehouseId: true },
      });
      if (existing) return existing;
      return tx.physicalInventory.create({
        data: {
          productId: params.productId,
          variantId: params.variantId,
          warehouseId,
          quantity: 0,
        },
        select: { id: true, quantity: true, warehouseId: true },
      });
    };

    for (const r of reservations) {
      for (const a of r.allocations) {
        const row = await tx.physicalInventory.findUnique({
          where: { id: a.physicalInventoryId },
          select: { id: true, quantity: true, warehouseId: true },
        });
        if (row) return { row };
      }
    }
    for (const r of reservations) {
      if (r.warehouseId) return { row: await warehouseLevel(r.warehouseId) };
    }
    if (params.productWarehouseId) {
      return { row: await warehouseLevel(params.productWarehouseId) };
    }
    const anyRow = await tx.physicalInventory.findFirst({
      where: { productId: params.productId, variantId: params.variantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, quantity: true, warehouseId: true },
    });
    if (anyRow) return { row: anyRow };

    try {
      const resolved = await this.initialPhysicalStock.resolveWarehouse(
        'MANAGED_STOCK',
        params.quantity,
      );
      if (resolved) return { row: await warehouseLevel(resolved) };
    } catch {
      // fall through — no warehouse resolvable
    }
    return null;
  }
}
