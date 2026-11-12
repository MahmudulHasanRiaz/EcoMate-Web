import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockReconciliationService } from '../stock/stock-reconciliation.service';

/**
 * Marker prefix for every ledger note the Q8 settlement writes
 * (q8-settle.service.ts computeOps: live release, already-deducted
 * release, residual sweep — all three start with this prefix).
 * The R6 finder ignores entries carrying it (see
 * computeManagedModeResidue): a settle is cleanup of already-retired
 * managed holds, not managed stock moving after the switch, so its own
 * entries must not re-create the residue flag they were written to clear.
 */
export const Q8_SETTLEMENT_NOTE_PREFIX = 'Q8 settlement — ';

export interface Q8SettleRequest {
  dryRun?: boolean;
  performedBy?: string;
}

export interface Q8SettleResult {
  dryRun: boolean;
  settled: {
    releasedUnits: number;
    flagsCleared: number;
    /** The exact note text of each RELEASE / ADJUSTMENT entry written — in a
     * dry run, the notes that WOULD be written, so the preview is exact. */
    ledgerEntries: string[];
  };
  /** Q8 verifier (ledger-vs-state) fail count for the affected units after
   * this run — for a dry run, the fail count as it stands now. */
  remainingFails: number;
  detail: string;
}

/**
 * Q8 orphaned managed-reservation settlement (2026-11-12, verify205 round).
 *
 * FINDINGS (code-verified 2026-11-12 — the staging Gadget unit):
 * - TEST-AUDIT Gadget (SKU TEST-AUDIT-002, now INVENTORY_CONTROLLED):
 *   product-row managedStockQuantity 0 / reservedStock 2 → available −2
 *   (Q8 FAIL). The 2 reserved units are the live holds on ORD-261024-0003
 *   (Pending) and ORD-261022-0008 (Return Pending); 2 further flagged lines
 *   are already deducted (ORD-261024-0002, ORD-261023-0003 — the counter was
 *   already decremented at delivery, only the stale flag remains). Root
 *   cause: the pre-#205 clearManagedStockForModeChange zeroed qty but never
 *   touched reservedStock or the managedStockReserved flags, and the stock
 *   router skips the managed leg for INVENTORY_CONTROLLED products, so no
 *   later order flow could ever settle them (see
 *   products.service.ts releaseManagedReservationsForModeChange docblock;
 *   fixed for future switches in PR #205).
 * - Settlement per unit: clear every managedStockReserved flag (OrderItem +
 *   OrderItemComboComponent) BEFORE any counter move (a retry can never
 *   double-release); a live hold decrements reservedStock with a RELEASE
 *   entry (reservedBefore → reservedAfter, referenceType ORDER, referenceId
 *   = order id); an already-deducted line gets a quantity-0 RELEASE entry
 *   and NO counter move (a second decrement would corrupt the counter); any
 *   counter remainder with no backing line is zeroed by the residual sweep
 *   with an ADJUSTMENT entry. Nothing else is written: no order status, no
 *   physical stock, no Return, nothing marked received (receive is always a
 *   manual employee act).
 * - §5 "5 Reserve ops vs 4 standing flags": RESERVE rows are append-only
 *   events — StockService writes one RESERVE row per reserve action
 *   (referenceType ORDER, referenceId = order UUID; stock.service.ts), so a
 *   re-reserved line writes a second RESERVE row for the same single flag,
 *   and a cancelled line's flag is cleared by the cancel path while its
 *   RESERVE row stays in history. Op counts therefore cannot prove a live
 *   hold; the live holds are exactly the flagged lines with
 *   managedStockDeducted=false, and the counter (2) agrees with them. This
 *   settlement is driven by flags + counter, never by op counts, and the
 *   residual sweep absorbs any remainder either story leaves behind.
 * - performedAt is stamped explicitly, +1ms per entry in write order: the
 *   column defaults to CURRENT_TIMESTAMP (transaction start), so entries
 *   written in one $transaction would otherwise share one timestamp and the
 *   Q8 verifier's last-snapshot read (performedAt desc, id desc) would pick
 *   among them by random uuid. The stamps are run-time values recording the
 *   true write order, not historical dates.
 */
@Injectable()
export class Q8SettleService {
  private readonly logger = new Logger(Q8SettleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliation: StockReconciliationService,
  ) {}

  /** One flagged order line holding (or having held) a managed reservation. */
  private static toLine(
    kind: 'item' | 'component',
    row: any,
  ): Q8FlaggedLine {
    const order = row.orderItem?.order ?? row.order ?? null;
    return {
      kind,
      id: row.id,
      qty: kind === 'item' ? row.quantity : row.totalQuantity,
      deducted: row.managedStockDeducted === true,
      orderId: order?.id ?? null,
      orderDisplayId: order?.displayId ?? null,
    };
  }

  /**
   * Orphan predicate — the SAME set the reconciliation finder flags as R6
   * (reconciliation-finder.service.ts): products whose availabilityMode is
   * now INVENTORY_CONTROLLED. A unit of such a product is orphaned when its
   * managed counter still holds reservedStock > 0 OR it still carries
   * flagged order lines: the router never moves the managed leg for IC
   * products, so those holds can never settle through any normal flow.
   * Units are enumerated exactly as the finder enumerates R6 units
   * (simple/combo → product row; variable → variant rows, plus the product
   * row when it holds reserved stock).
   */
  private async findOrphanedUnits(
    client: PrismaService | any,
  ): Promise<{ units: Q8OrphanUnit[]; scannedIcProducts: number }> {
    const products = await client.product.findMany({
      where: { availabilityMode: 'INVENTORY_CONTROLLED' },
      select: {
        id: true,
        name: true,
        type: true,
        managedStockQuantity: true,
        reservedStock: true,
        variants: {
          select: { id: true, managedStockQuantity: true, reservedStock: true },
        },
      },
    });
    const units: Q8OrphanUnit[] = [];
    for (const p of products ?? []) {
      const rows: { variantId: string | null; onHand: number; reserved: number }[] =
        [];
      if (p.type === 'variable') {
        for (const v of p.variants ?? []) {
          rows.push({
            variantId: v.id,
            onHand: v.managedStockQuantity ?? 0,
            reserved: v.reservedStock ?? 0,
          });
        }
        // A variable product's own counter never holds reservations (lines
        // carry variantId), but sweep it if something stranded reserved
        // stock there anyway.
        if ((p.reservedStock ?? 0) > 0) {
          rows.push({
            variantId: null,
            onHand: p.managedStockQuantity ?? 0,
            reserved: p.reservedStock ?? 0,
          });
        }
      } else {
        rows.push({
          variantId: null,
          onHand: p.managedStockQuantity ?? 0,
          reserved: p.reservedStock ?? 0,
        });
      }
      for (const row of rows) {
        const [items, components] = await Promise.all([
          client.orderItem.findMany({
            where: {
              productId: p.id,
              variantId: row.variantId ?? null,
              managedStockReserved: true,
            },
            select: {
              id: true,
              quantity: true,
              managedStockDeducted: true,
              order: { select: { id: true, displayId: true } },
            },
          }),
          client.orderItemComboComponent.findMany({
            where: {
              productId: p.id,
              variantId: row.variantId ?? null,
              managedStockReserved: true,
            },
            select: {
              id: true,
              totalQuantity: true,
              managedStockDeducted: true,
              orderItem: {
                select: { order: { select: { id: true, displayId: true } } },
              },
            },
          }),
        ]);
        const lines: Q8FlaggedLine[] = [
          ...(items ?? []).map((i: any) => Q8SettleService.toLine('item', i)),
          ...(components ?? []).map((c: any) =>
            Q8SettleService.toLine('component', c),
          ),
        ];
        if (row.reserved <= 0 && lines.length === 0) continue;
        units.push({
          productId: p.id,
          productName: p.name,
          variantId: row.variantId,
          onHand: row.onHand,
          reserved: row.reserved,
          lines,
        });
      }
    }
    return { units, scannedIcProducts: products?.length ?? 0 };
  }

  /**
   * Pure settlement plan for one unit: the ordered ledger ops + totals.
   * The dry run and the real run both derive from this, so the preview is
   * exactly what the write does. releasedUnits counts every reserved unit
   * removed from the counter (live releases + residual sweep).
   */
  private computeOps(unit: Q8OrphanUnit): {
    ops: Q8SettleOp[];
    releasedUnits: number;
  } {
    const ops: Q8SettleOp[] = [];
    let running = unit.reserved;
    let released = 0;
    for (const line of unit.lines.filter((l) => !l.deducted)) {
      // Live hold: release the counter. Clamp to what the counter holds —
      // a counter short of the flagged qty is itself corrupt data, and the
      // shortfall is named in the note rather than driving it negative.
      const rel = Math.min(line.qty, running);
      const before = running;
      running -= rel;
      released += rel;
      const ref = line.orderDisplayId ?? line.orderId ?? 'unknown order';
      ops.push({
        kind: 'release-live',
        line,
        released: rel,
        reservedBefore: before,
        reservedAfter: running,
        note:
          `${Q8_SETTLEMENT_NOTE_PREFIX}released ${rel} reserved unit(s) for order ${ref} ` +
          `(managed layer retired for INVENTORY_CONTROLLED; the hold is inert)` +
          (rel < line.qty
            ? ` — shortfall ${line.qty - rel}: counter held less than the flagged hold`
            : ''),
      });
    }
    for (const line of unit.lines.filter((l) => l.deducted)) {
      const ref = line.orderDisplayId ?? line.orderId ?? 'unknown order';
      ops.push({
        kind: 'release-deducted',
        line,
        reservedAt: running,
        note:
          `${Q8_SETTLEMENT_NOTE_PREFIX}cleared already-deducted reservation flag for order ${ref} ` +
          `(stock was deducted at delivery; no counter move)`,
      });
    }
    if (running > 0) {
      ops.push({
        kind: 'residual',
        residual: running,
        note:
          `${Q8_SETTLEMENT_NOTE_PREFIX}cleared ${running} orphaned reserved unit(s) with no ` +
          `backing reservation line (managed layer retired)`,
      });
      released += running;
      running = 0;
    }
    return { ops, releasedUnits: released };
  }

  private unitKey(unit: Q8OrphanUnit): string {
    return `p:${unit.productId}|${unit.variantId ?? ''}`;
  }

  private unitSummary(
    unit: Q8OrphanUnit,
    releasedUnits: number,
    entryCount: number,
  ): string {
    const stranded =
      unit.onHand !== 0
        ? `; managed qty ${unit.onHand} still stranded — R6 owns it, untouched here`
        : '';
    return (
      `"${unit.productName}" (${this.unitKey(unit)}): released ${releasedUnits} ` +
      `unit(s), cleared ${unit.lines.length} flag(s), ${entryCount} ledger entr` +
      `${entryCount === 1 ? 'y' : 'ies'}${stranded}`
    );
  }

  async settle(input: Q8SettleRequest = {}): Promise<Q8SettleResult> {
    const dryRun = input.dryRun === true;
    const performedBy = input.performedBy ?? 'system';

    // Preview read (also the dry-run result): what is orphaned right now.
    const preview = await this.findOrphanedUnits(this.prisma);
    const previewKeys = preview.units.map((u) => this.unitKey(u));

    if (dryRun) {
      let releasedUnits = 0;
      let flagsCleared = 0;
      const ledgerEntries: string[] = [];
      const summaries: string[] = [];
      for (const unit of preview.units) {
        const { ops, releasedUnits: rel } = this.computeOps(unit);
        releasedUnits += rel;
        flagsCleared += unit.lines.length;
        ledgerEntries.push(...ops.map((o) => o.note));
        summaries.push(this.unitSummary(unit, rel, ops.length));
      }
      const verification = await this.reconciliation.verifyStockIntegrity(
        previewKeys,
      );
      return {
        dryRun: true,
        settled: { releasedUnits, flagsCleared, ledgerEntries },
        remainingFails: verification.fail,
        detail:
          preview.units.length === 0
            ? `Dry run — no writes. No Q8-orphaned units found among ` +
              `${preview.scannedIcProducts} INVENTORY_CONTROLLED product(s).`
            : `Dry run — no writes. Would settle ${preview.units.length} orphaned ` +
              `unit(s) among ${preview.scannedIcProducts} INVENTORY_CONTROLLED ` +
              `product(s): ${summaries.join('; ')}. ` +
              `Q8 fails for these units now: ${verification.fail}.`,
      };
    }

    // Real run: re-derive the plan INSIDE one transaction, so a concurrent
    // settle (or a mode fix landing first) cannot double-release the same
    // line — the tx plan is what is applied, and the response reports it.
    const applied = await this.prisma.$transaction(async (tx: any) => {
      const fresh = await this.findOrphanedUnits(tx);
      let releasedUnits = 0;
      let flagsCleared = 0;
      const ledgerEntries: string[] = [];
      const settledKeys: string[] = [];
      const summaries: string[] = [];
      // Explicit, strictly increasing performedAt stamps (see file docblock).
      let stamp = Date.now();
      for (const unit of fresh.units) {
        const { ops, releasedUnits: rel } = this.computeOps(unit);
        // Clear every flag FIRST: a failure mid-loop can never
        // double-release the same line on retry (same convention as
        // products.service.ts).
        const itemIds = unit.lines
          .filter((l) => l.kind === 'item')
          .map((l) => l.id);
        const compIds = unit.lines
          .filter((l) => l.kind === 'component')
          .map((l) => l.id);
        if (itemIds.length > 0) {
          await tx.orderItem.updateMany({
            where: { id: { in: itemIds } },
            data: { managedStockReserved: false },
          });
        }
        if (compIds.length > 0) {
          await tx.orderItemComboComponent.updateMany({
            where: { id: { in: compIds } },
            data: { managedStockReserved: false },
          });
        }
        for (const op of ops) {
          const performedAt = new Date(stamp);
          stamp += 1;
          const base = {
            productId: unit.productId,
            ...(unit.variantId ? { variantId: unit.variantId } : {}),
            stockBefore: unit.onHand,
            stockAfter: unit.onHand,
            note: op.note,
            performedById: performedBy,
            performedAt,
          };
          if (op.kind === 'release-live') {
            if (op.released > 0) {
              if (unit.variantId) {
                await tx.productVariant.update({
                  where: { id: unit.variantId },
                  data: { reservedStock: { decrement: op.released } },
                });
              } else {
                await tx.product.update({
                  where: { id: unit.productId },
                  data: { reservedStock: { decrement: op.released } },
                });
              }
            }
            await tx.managedStockLedger.create({
              data: {
                ...base,
                quantity: op.released,
                direction: 'IN',
                type: 'RELEASE',
                reservedBefore: op.reservedBefore,
                reservedAfter: op.reservedAfter,
                referenceType: 'ORDER',
                referenceId: op.line.orderId,
              },
            });
          } else if (op.kind === 'release-deducted') {
            await tx.managedStockLedger.create({
              data: {
                ...base,
                quantity: 0,
                direction: 'IN',
                type: 'RELEASE',
                reservedBefore: op.reservedAt,
                reservedAfter: op.reservedAt,
                referenceType: 'ORDER',
                referenceId: op.line.orderId,
              },
            });
          } else {
            if (unit.variantId) {
              await tx.productVariant.update({
                where: { id: unit.variantId },
                data: { reservedStock: 0 },
              });
            } else {
              await tx.product.update({
                where: { id: unit.productId },
                data: { reservedStock: 0 },
              });
            }
            await tx.managedStockLedger.create({
              data: {
                ...base,
                quantity: op.residual,
                direction: 'IN',
                type: 'ADJUSTMENT',
                reservedBefore: op.residual,
                reservedAfter: 0,
              },
            });
          }
        }
        releasedUnits += rel;
        flagsCleared += unit.lines.length;
        ledgerEntries.push(...ops.map((o) => o.note));
        settledKeys.push(this.unitKey(unit));
        summaries.push(this.unitSummary(unit, rel, ops.length));
      }
      return {
        releasedUnits,
        flagsCleared,
        ledgerEntries,
        settledKeys,
        summaries,
        settledUnits: fresh.units.length,
        scannedIcProducts: fresh.scannedIcProducts,
      };
    });

    // Q8 re-check over the affected units (preview keys + settled keys —
    // a concurrent settle may have taken a preview unit first).
    const verifyKeys = [
      ...new Set([...previewKeys, ...applied.settledKeys]),
    ];
    const verification =
      await this.reconciliation.verifyStockIntegrity(verifyKeys);
    this.logger.log(
      `Q8 settle by ${performedBy}: ${applied.settledUnits} unit(s), ` +
        `${applied.releasedUnits} reserved unit(s) released, ` +
        `${applied.flagsCleared} flag(s) cleared, ` +
        `${applied.ledgerEntries.length} ledger entries; ` +
        `Q8 fails remaining for these units: ${verification.fail}`,
    );
    return {
      dryRun: false,
      settled: {
        releasedUnits: applied.releasedUnits,
        flagsCleared: applied.flagsCleared,
        ledgerEntries: applied.ledgerEntries,
      },
      remainingFails: verification.fail,
      detail:
        applied.settledUnits === 0
          ? `No Q8-orphaned units found among ${applied.scannedIcProducts} ` +
            `INVENTORY_CONTROLLED product(s) — nothing written.`
          : `Settled ${applied.settledUnits} orphaned unit(s) among ` +
            `${applied.scannedIcProducts} INVENTORY_CONTROLLED product(s): ` +
            `${applied.summaries.join('; ')}. ` +
            `Q8 fails remaining for these units: ${verification.fail}.`,
    };
  }
}

interface Q8FlaggedLine {
  kind: 'item' | 'component';
  id: string;
  qty: number;
  deducted: boolean;
  orderId: string | null;
  orderDisplayId: string | null;
}

interface Q8OrphanUnit {
  productId: string;
  productName: string;
  variantId: string | null;
  onHand: number;
  reserved: number;
  lines: Q8FlaggedLine[];
}

type Q8SettleOp =
  | {
      kind: 'release-live';
      line: Q8FlaggedLine;
      released: number;
      reservedBefore: number;
      reservedAfter: number;
      note: string;
    }
  | {
      kind: 'release-deducted';
      line: Q8FlaggedLine;
      reservedAt: number;
      note: string;
    }
  | { kind: 'residual'; residual: number; note: string };
