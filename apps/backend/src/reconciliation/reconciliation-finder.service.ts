import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockRouterService } from '../stock/stock-router.service';
import { StockReconciliationService } from '../stock/stock-reconciliation.service';

/**
 * Stock-reconciliation FINDER (2026-10-30 directive §3/§4).
 *
 * Record-based, read-only. A missed restock is proven from RECORDS — a
 * staff-received Return row plus the ABSENCE of the matching ledger add —
 * never from flags (the stranded classes are precisely the ones whose
 * flags/claims were already disarmed, which is why the old boot heal could
 * never see them).
 *
 * Ledger matching keys (exactly what the receive path writes):
 *   managed  — ManagedStockLedger type='RETURN', referenceType='RETURN',
 *              referenceId = `return-<returnId>`
 *   physical — PhysicalInventoryLedger type='RESTORATION',
 *              reason = `return-<returnId>`
 * The BLANKET restore path (CancelReturnStockService.restoreForOrder —
 * cancel / heal / full-return restores) keys the same adds by ORDER
 * instead: managed referenceId = `return-<orderId>` (referenceType
 * defaults to 'MANUAL'), physical reason = `return-<orderId>`. Those adds
 * are real restores of the order's returns, so the evidence sums accept
 * BOTH key shapes — otherwise every blanket-restored return was flagged
 * missing and an Apply would have restored it a second time.
 *
 * Categories:
 *   R1 — managed add missing for a return item that carries a variant
 *        (the pre-#134 stranded-variable class; simple-product managed
 *        misses and physical misses are R2).
 *   R2 — layer-missing restore (managed and/or physical) not in R1.
 *   R3 — lingering managed flags on Cancelled/Returned orders, and
 *        physical shortages for lines whose order shows NO physical
 *        reservation record and NO physical deduction evidence (the
 *        physical layer was never engaged — nothing to restore). Report
 *        ONLY: the normal receive path / healOrder owns the flag class;
 *        applying them here would double-count against the idempotency
 *        proof.
 *   R4 — human disposition only (quantity unknowable from records, or a
 *        courier-reported return with NO Return record at all). Never
 *        applied — a system cannot invent a quantity no record holds.
 *   R5 — out of scope, counts only (see buildReport).
 *   R6 — (2026-11-11, stock-mode round §5) product is
 *        INVENTORY_CONTROLLED but a managed quantity is stranded on it,
 *        or its managed ledger carries residue of an uncleaned mode
 *        switch. APPLY-ABLE: heal zeroes the managed qty and writes the
 *        mode-change ledger entry, exactly as products.service does.
 *        A unit (product row for simple/combo, variant row for
 *        variable products) is flagged when EITHER:
 *          (a) stranded quantity — managedStockQuantity ≠ 0 (any sign;
 *              the pre-fix mode-switch cleanup skipped qty ≤ 0, combos
 *              and the draft path, stranding negatives in particular);
 *          (b) ledger residue — the unit's ManagedStockLedger contains
 *              a mode-change entry (type='ADJUSTMENT', note starting
 *              'Mode changed from MANAGED_STOCK to
 *              INVENTORY_CONTROLLED') AND at least one further managed
 *              entry performed AFTER it: managed stock kept moving
 *              after the switch, so the switch was never cleaned up.
 *              The heal's own mode-change entry becomes the last entry,
 *              so a re-run finds no residue (idempotency key).
 *   R7 — (2026-11-11, stock-mode round §5) REPORT-ONLY, never applied:
 *        a PhysicalInventory row with quantity > 0 whose
 *        product|variant|warehouse key has NO CostingLot AND NO
 *        PhysicalInventoryLedger row — no legitimate origin record, so
 *        it looks like a legacy mirror copy from the removed
 *        auto-mirror behaviour. Deleting stock automatically would be
 *        unsafe; a human dispositions each row.
 *   R8 — (2026-11-11, owner decision) legacy Return-record backfill:
 *        orders that were returned the pre-Return-system way (Return
 *        Pending → staff directly marked Returned) have NO Return row.
 *        Evidence source = the order's own timeline (status entries
 *        {status, timestamp, performedBy} written by updateStatus) —
 *        never a fabricated date. Classification (shared verbatim with
 *        the apply service via classifyLegacyReturn):
 *          terminal — current status Returned + a parseable 'Returned'
 *            timeline transition: backfill a RESTOCKED, stockReconciled
 *            Return (receivedAt = transition date) whose restore is an
 *            ALREADY-DONE fact — the apply writes per-return evidence
 *            keys (return-<returnId>, the real receive path's keying)
 *            with stockBefore == stockAfter and moves NO stock.
 *          pending — current status Return Pending + a parseable
 *            'Return Pending' transition and NO 'Returned' transition:
 *            backfill a REQUESTED Return only. It is NEVER marked
 *            received (receive is always a manual employee act).
 *          human (sub-label R8-H, report-only) — ambiguous evidence:
 *            missing/unparseable transition date, contradictory
 *            transitions, partial-return indications, a PARTIAL
 *            dispatch, a Damaged order that passed through Returned,
 *            or an order with no lines. Never backfilled.
 *        Idempotency key: orderId + absence of a Return row.
 */

export type ReconCategory = 'R1' | 'R2' | 'R3' | 'R4' | 'R6' | 'R7' | 'R8';
export type ReconLayer = 'managed' | 'physical' | 'both';

export interface ReconRow {
  id: string;
  category: ReconCategory;
  orderId: string;
  orderDisplayId: string;
  returnId: string | null;
  returnDisplayId: string | null;
  productId: string;
  productName: string;
  variantId: string | null;
  layer: ReconLayer;
  orderedQty: number;
  receivedGoodQty: number;
  damagedQty: number;
  alreadyRestoredManaged: number;
  alreadyRestoredPhysical: number;
  missingManagedQty: number;
  missingPhysicalQty: number;
  evidence: string;
  /** R6 only: the signed managed quantity stranded on the unit. */
  strandedManagedQty?: number;
  /** R7 only: the physical quantity on the suspected mirror row. */
  physicalQty?: number;
  /** R7 only: the warehouse the suspected mirror row sits in. */
  warehouseId?: string | null;
  /** R8 only: 'terminal' | 'pending' are backfillable; 'human' = R8-H. */
  r8Kind?: 'terminal' | 'pending' | 'human';
  /** R8 only: ISO timestamp of the decisive historical transition. */
  legacyAt?: string;
  /** R8 only: historical actor recorded on that transition, if any. */
  legacyActor?: string | null;
}

export interface ReconCheck {
  key: string;
  label: string;
  value: number;
  pass: boolean | null; // null = informational (list, not a gate)
  detail: string;
}

export interface ReconReport {
  generatedAt: string;
  imEnabled: boolean;
  rows: ReconRow[];
  counts: {
    R1: number;
    R2: number;
    R3: number;
    R4: number;
    R5: Record<string, number>;
    R6: number;
    R7: number;
    /** Backfillable R8 rows (terminal + pending). */
    R8: number;
    /** Report-only R8-H rows (ambiguous legacy evidence). */
    R8H: number;
  };
  checks: ReconCheck[];
}

export const RECEIVED_RETURN_STATUSES = ['RECEIVED', 'RESTOCKED', 'CLOSED'] as const;
const TERMINAL_ORDER_STATUSES = ['Delivered', 'Partial', 'Cancelled', 'Returned'];

/**
 * The mode-change ledger evidence key (R6 branch (b)): products.service
 * writes the cleanup entry on a MANAGED_STOCK → INVENTORY_CONTROLLED
 * switch as type='ADJUSTMENT' with a note in this exact wording family.
 */
export const MODE_CHANGE_TO_IC_NOTE_PREFIX =
  'Mode changed from MANAGED_STOCK to INVENTORY_CONTROLLED';

export interface LegacyReturnClassification {
  kind: 'terminal' | 'pending' | 'human';
  pendingAt: Date | null;
  returnedAt: Date | null;
  /** performedBy recorded on the decisive timeline transition. */
  actor: string | null;
  /** For kind='human': why the evidence is ambiguous (R8-H reason). */
  reason: string;
}

export interface ManagedModeResidue {
  residue: boolean;
  /** performedAt of the last mode-change entry, when one exists. */
  lastModeChangeAt: Date | null;
  /** Managed entries performed after that mode-change entry. */
  laterEntries: number;
}

/**
 * Pure residue computation over one unit's managed ledger entries
 * (any order — sorted here by performedAt). Residue = a mode-change
 * entry exists AND at least one managed entry was performed after it.
 */
export function computeManagedModeResidue(
  entries: { note?: string | null; performedAt?: Date | string | null }[],
): ManagedModeResidue {
  const sorted = [...entries].sort((a, b) => {
    const ta = a.performedAt ? new Date(a.performedAt as any).getTime() : 0;
    const tb = b.performedAt ? new Date(b.performedAt as any).getTime() : 0;
    return ta - tb;
  });
  let lastIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    const note = sorted[i].note ?? '';
    if (note.startsWith(MODE_CHANGE_TO_IC_NOTE_PREFIX)) lastIdx = i;
  }
  if (lastIdx < 0) return { residue: false, lastModeChangeAt: null, laterEntries: 0 };
  const laterEntries = sorted.length - 1 - lastIdx;
  return {
    residue: laterEntries > 0,
    lastModeChangeAt: sorted[lastIdx].performedAt
      ? new Date(sorted[lastIdx].performedAt as any)
      : null,
    laterEntries,
  };
}

@Injectable()
export class ReconciliationFinderService {
  private readonly logger = new Logger(ReconciliationFinderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stockRouter: StockRouterService,
    private readonly reconciliation: StockReconciliationService,
  ) {}

  private rowId(
    category: ReconCategory,
    returnId: string | null,
    orderId: string,
    productId: string,
    variantId: string | null,
    layer: ReconLayer,
  ): string {
    return [category, returnId ?? orderId, productId, variantId ?? '', layer].join('|');
  }

  /** Σ managed RETURN adds for one return, keyed product|variant. */
  async managedRestoredByReturn(
    returnIds: string[],
    client: PrismaService | any = this.prisma,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (returnIds.length === 0) return map;
    const rows = await client.managedStockLedger.findMany({
      where: {
        type: 'RETURN',
        referenceType: 'RETURN',
        referenceId: { in: returnIds.map((id) => `return-${id}`) },
        direction: 'IN',
      },
      select: { referenceId: true, productId: true, variantId: true, quantity: true },
    });
    for (const r of rows) {
      const key = `${r.referenceId}|${r.productId}|${r.variantId ?? ''}`;
      map.set(key, (map.get(key) ?? 0) + (r.quantity ?? 0));
    }
    return map;
  }

  /** Σ physical RESTORATION adds for one return, keyed product|variant. */
  async physicalRestoredByReturn(
    returnIds: string[],
    client: PrismaService | any = this.prisma,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (returnIds.length === 0) return map;
    const rows = await client.physicalInventoryLedger.findMany({
      where: {
        type: 'RESTORATION',
        reason: { in: returnIds.map((id) => `return-${id}`) },
        direction: 'IN',
      },
      select: { reason: true, productId: true, variantId: true, quantity: true },
    });
    for (const r of rows) {
      const key = `${r.reason}|${r.productId}|${r.variantId ?? ''}`;
      map.set(key, (map.get(key) ?? 0) + (r.quantity ?? 0));
    }
    return map;
  }

  /**
   * Σ managed RETURN adds written by the BLANKET restore path, keyed
   * `return-<orderId>|product|variant`. Blanket adds carry the same
   * type='RETURN' as the per-return path but key referenceId by ORDER
   * (referenceType defaults to 'MANUAL'), so they are matched on
   * referenceId alone — order ids and return ids never collide.
   */
  async managedRestoredByOrder(
    orderIds: string[],
    client: PrismaService | any = this.prisma,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (orderIds.length === 0) return map;
    const rows = await client.managedStockLedger.findMany({
      where: {
        type: 'RETURN',
        referenceId: { in: orderIds.map((id) => `return-${id}`) },
        direction: 'IN',
      },
      select: { referenceId: true, productId: true, variantId: true, quantity: true },
    });
    for (const r of rows) {
      const key = `${r.referenceId}|${r.productId}|${r.variantId ?? ''}`;
      map.set(key, (map.get(key) ?? 0) + (r.quantity ?? 0));
    }
    return map;
  }

  /**
   * Σ physical RESTORATION adds written by the BLANKET restore path,
   * keyed `return-<orderId>|product|variant` (reason carries the order
   * key, exactly as restoreForOrder writes it).
   */
  async physicalRestoredByOrder(
    orderIds: string[],
    client: PrismaService | any = this.prisma,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (orderIds.length === 0) return map;
    const rows = await client.physicalInventoryLedger.findMany({
      where: {
        type: 'RESTORATION',
        reason: { in: orderIds.map((id) => `return-${id}`) },
        direction: 'IN',
      },
      select: { reason: true, productId: true, variantId: true, quantity: true },
    });
    for (const r of rows) {
      const key = `${r.reason}|${r.productId}|${r.variantId ?? ''}`;
      map.set(key, (map.get(key) ?? 0) + (r.quantity ?? 0));
    }
    return map;
  }

  /**
   * R6 branch (b) evidence for ONE unit, against any client (the apply
   * service re-checks it inside its transaction with the tx client).
   * Keyed exactly as the ledger is keyed: productId + variantId (null
   * for the product-level unit).
   */
  async managedModeResidue(
    productId: string,
    variantId: string | null,
    client: PrismaService | any = this.prisma,
  ): Promise<ManagedModeResidue> {
    const entries = await client.managedStockLedger.findMany({
      where: { productId, variantId: variantId ?? null },
      select: { note: true, performedAt: true },
      orderBy: { performedAt: 'asc' },
    });
    return computeManagedModeResidue(entries);
  }

  /** IM flag, exposed for the apply service's R8 coverage decision. */
  async isInventoryManagementEnabled(): Promise<boolean> {
    return this.stockRouter.isInventoryManagementEnabled();
  }

  /**
   * R8 legacy classification — the SINGLE definition shared by the
   * finder (report) and the apply service (in-transaction re-check), so
   * a row can never be reported backfillable and then classified
   * differently at write time. Evidence = the order timeline's status
   * entries ({status, timestamp, performedBy}, as updateStatus writes
   * them); the LAST transition of each kind wins, mirroring the
   * analytics metric-contract's latestTransition pattern. A date is
   * used only when present AND parseable — never fabricated.
   */
  classifyLegacyReturn(order: {
    statusName: string;
    timeline: unknown;
  }): LegacyReturnClassification {
    const entries: any[] = Array.isArray(order.timeline) ? order.timeline : [];
    const lastOf = (status: string): any | null => {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i]?.status === status) return entries[i];
      }
      return null;
    };
    const parseTs = (e: any | null): Date | null => {
      if (!e?.timestamp) return null;
      const d = new Date(e.timestamp);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const actorOf = (e: any | null): string | null =>
      typeof e?.performedBy === 'string' && e.performedBy ? e.performedBy : null;
    const pendingEntry = lastOf('Return Pending');
    const returnedEntry = lastOf('Returned');
    const pendingAt = parseTs(pendingEntry);
    const returnedAt = parseTs(returnedEntry);
    const partialNote = [pendingEntry?.note, returnedEntry?.note].some(
      (n) => typeof n === 'string' && /partial/i.test(n),
    );
    const base = { pendingAt, returnedAt, actor: null as string | null, reason: '' };

    if (order.statusName === 'Returned') {
      if (!returnedEntry) {
        return {
          ...base,
          kind: 'human',
          reason:
            'order status is Returned but the timeline holds NO Returned ' +
            'transition — the return date is unknowable from records and ' +
            'is never fabricated',
        };
      }
      if (!returnedAt) {
        return {
          ...base,
          kind: 'human',
          reason: 'the Returned timeline transition has no parseable timestamp',
        };
      }
      if (partialNote) {
        return {
          ...base,
          kind: 'human',
          reason:
            'the return transition note indicates a PARTIAL return — the ' +
            'legacy blanket flow was full-order, so quantities are ambiguous',
        };
      }
      return { ...base, kind: 'terminal', actor: actorOf(returnedEntry) };
    }

    if (order.statusName === 'Return Pending') {
      if (returnedEntry) {
        return {
          ...base,
          kind: 'human',
          reason:
            'the timeline shows a Returned transition but the order status ' +
            'is Return Pending — contradictory evidence',
        };
      }
      if (!pendingEntry || !pendingAt) {
        return {
          ...base,
          kind: 'human',
          reason:
            'no parseable Return Pending timeline transition — the date is ' +
            'unknowable from records and is never fabricated',
        };
      }
      if (partialNote) {
        return {
          ...base,
          kind: 'human',
          reason:
            'the Return Pending transition note indicates a PARTIAL return — ' +
            'quantities are ambiguous for a full-order backfill',
        };
      }
      return { ...base, kind: 'pending', actor: actorOf(pendingEntry) };
    }

    // Damaged (the only other candidate status the finder passes in):
    // a return was completed and the order later went Damaged — tangled
    // with the damage write-off flow, human disposition only.
    return {
      ...base,
      kind: 'human',
      actor: actorOf(returnedEntry),
      reason:
        'the order passed through Returned and is now Damaged — the return ' +
        'evidence is tangled with the damage flow; human disposition required',
    };
  }

  async buildReport(): Promise<ReconReport> {
    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
    const rows: ReconRow[] = [];

    // ── Received returns → R1 / R2 / R4(qty unknowable) ─────────────────
    const returns = await this.prisma.return.findMany({
      where: { status: { in: [...RECEIVED_RETURN_STATUSES] } },
      select: {
        id: true,
        displayId: true,
        orderId: true,
        type: true,
        status: true,
        items: true,
        stockReconciled: true,
      },
    });
    const returnIds = returns.map((r) => r.id);
    const orderIds = [...new Set(returns.map((r) => r.orderId))];
    const [
      managedRestored,
      physicalRestored,
      managedBlanket,
      physicalBlanket,
    ] = await Promise.all([
      this.managedRestoredByReturn(returnIds),
      this.physicalRestoredByReturn(returnIds),
      this.managedRestoredByOrder(orderIds),
      this.physicalRestoredByOrder(orderIds),
    ]);

    const orders = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: {
            id: true,
            displayId: true,
            items: { select: { productId: true, variantId: true, quantity: true } },
          },
        })
      : [];
    const orderById = new Map(orders.map((o) => [o.id, o]));

    const productIds = new Set<string>();
    for (const r of returns) {
      for (const it of (r.items as any[]) ?? []) {
        if (it?.productId) productIds.add(it.productId);
      }
    }
    const products = productIds.size
      ? await this.prisma.product.findMany({
          where: { id: { in: [...productIds] } },
          select: { id: true, name: true, availabilityMode: true, manageStock: true },
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    // Physical-layer applicability evidence, keyed order|product|variant:
    // a physical reservation record (either reservation table, any status)
    // or a physical DEDUCTION ledger row naming the order (the delivered
    // path writes reason `Order Delivered: <displayId>`). When NEITHER
    // exists for a line, the physical layer was never engaged for it —
    // nothing was ever deducted, so nothing can be missing: a would-be
    // physical shortage is report-only (R3), never an applicable R1/R2.
    const physicalEvidence = new Set<string>();
    if (orderIds.length) {
      const [resv, comboResv] = await Promise.all([
        this.prisma.physicalReservation.findMany({
          where: { orderId: { in: orderIds } },
          select: { orderId: true, productId: true, variantId: true },
        }),
        this.prisma.comboComponentPhysicalReservation.findMany({
          where: { orderId: { in: orderIds } },
          select: { orderId: true, productId: true, variantId: true },
        }),
      ]);
      for (const r of [...resv, ...comboResv]) {
        physicalEvidence.add(
          `${r.orderId}|${r.productId}|${r.variantId ?? ''}`,
        );
      }
      if (productIds.size) {
        const deductions = await this.prisma.physicalInventoryLedger.findMany({
          where: {
            type: 'DEDUCTION',
            direction: 'OUT',
            productId: { in: [...productIds] },
          },
          select: { productId: true, variantId: true, reason: true },
        });
        for (const o of orders) {
          for (const d of deductions) {
            if (
              d.reason &&
              (d.reason.includes(o.displayId) || d.reason.includes(o.id))
            ) {
              physicalEvidence.add(
                `${o.id}|${d.productId}|${d.variantId ?? ''}`,
              );
            }
          }
        }
      }
    }

    for (const r of returns) {
      const order = orderById.get(r.orderId);
      const items = ((r.items as any[]) ?? []).filter((i) => i?.productId);
      for (const it of items) {
        const product = productById.get(it.productId);
        const mode = (product?.availabilityMode as string) ?? 'MANAGED_STOCK';
        const variantId: string | null = it.variantId ?? null;
        const qtyKnown =
          typeof it.quantity === 'number' && Number.isFinite(it.quantity);
        const damaged = qtyKnown ? (it.damagedQuantity ?? 0) : 0;
        const good = qtyKnown ? Math.max(0, it.quantity - damaged) : 0;
        const orderedQty =
          order?.items.find(
            (li) => li.productId === it.productId && (li.variantId ?? null) === variantId,
          )?.quantity ?? (qtyKnown ? it.quantity : 0);
        const blanketManaged =
          managedBlanket.get(`return-${r.orderId}|${it.productId}|${variantId ?? ''}`) ?? 0;
        const blanketPhysical =
          physicalBlanket.get(`return-${r.orderId}|${it.productId}|${variantId ?? ''}`) ?? 0;
        const restoredManaged =
          (managedRestored.get(`return-${r.id}|${it.productId}|${variantId ?? ''}`) ?? 0) +
          blanketManaged;
        const restoredPhysical =
          (physicalRestored.get(`return-${r.id}|${it.productId}|${variantId ?? ''}`) ?? 0) +
          blanketPhysical;

        if (!qtyKnown) {
          rows.push({
            id: this.rowId('R4', r.id, r.orderId, it.productId, variantId, 'managed'),
            category: 'R4',
            orderId: r.orderId,
            orderDisplayId: order?.displayId ?? '',
            returnId: r.id,
            returnDisplayId: r.displayId,
            productId: it.productId,
            productName: product?.name ?? it.productId,
            variantId,
            layer: 'managed',
            orderedQty,
            receivedGoodQty: 0,
            damagedQty: 0,
            alreadyRestoredManaged: restoredManaged,
            alreadyRestoredPhysical: restoredPhysical,
            missingManagedQty: 0,
            missingPhysicalQty: 0,
            evidence:
              'Return item carries no recorded quantity — received good qty is ' +
              'unknowable from records. Staff disposition required; never auto-applied.',
          });
          continue;
        }
        if (good <= 0) continue; // damaged-only / zero — nothing to restore (Q7 rule)

        // Managed expectation needs BOTH the mode and the product's
        // manageStock flag — a MANAGED_STOCK product with stock tracking
        // switched off has no managed counter to restore into.
        const managedExpected =
          mode === 'MANAGED_STOCK' && product?.manageStock !== false;
        const physicalExpected =
          imEnabled && (mode === 'MANAGED_STOCK' || mode === 'INVENTORY_CONTROLLED');
        const missingManaged = managedExpected
          ? Math.min(Math.max(0, good - restoredManaged), orderedQty || good)
          : 0;
        const missingPhysical = physicalExpected
          ? Math.min(Math.max(0, good - restoredPhysical), orderedQty || good)
          : 0;
        if (missingManaged <= 0 && missingPhysical <= 0) continue;

        // Physical applicability: with NO physical reservation record and
        // NO physical deduction evidence for this line, the physical layer
        // was never engaged — the shortage is not applicable. Report-only
        // (R3) when it is the only shortage; otherwise the row stays
        // R1/R2 on the managed layer alone.
        const physicalApplicable = physicalEvidence.has(
          `${r.orderId}|${it.productId}|${variantId ?? ''}`,
        );
        const missingPhysicalApplied =
          missingPhysical > 0 && !physicalApplicable ? 0 : missingPhysical;
        if (missingPhysicalApplied < missingPhysical && missingManaged <= 0) {
          rows.push({
            id: this.rowId('R3', r.id, r.orderId, it.productId, variantId, 'physical'),
            category: 'R3',
            orderId: r.orderId,
            orderDisplayId: order?.displayId ?? '',
            returnId: r.id,
            returnDisplayId: r.displayId,
            productId: it.productId,
            productName: product?.name ?? it.productId,
            variantId,
            layer: 'physical',
            orderedQty,
            receivedGoodQty: good,
            damagedQty: damaged,
            alreadyRestoredManaged: restoredManaged,
            alreadyRestoredPhysical: restoredPhysical,
            missingManagedQty: 0,
            missingPhysicalQty: 0,
            evidence:
              `return status=${r.status}; physical RESTORATION Σ=${restoredPhysical} ` +
              `(reason return-${r.id} / blanket return-${r.orderId} Σ=${blanketPhysical}) ` +
              `but the order shows NO physical reservation record and NO physical ` +
              `deduction ledger evidence for this line — the physical layer was ` +
              `never engaged, so the apparent shortage of ${missingPhysical} is not ` +
              'applicable. Report only, never applied.',
          });
          continue;
        }

        const category: ReconCategory =
          missingManaged > 0 && variantId ? 'R1' : 'R2';
        const layer: ReconLayer =
          missingManaged > 0 && missingPhysicalApplied > 0
            ? 'both'
            : missingManaged > 0
              ? 'managed'
              : 'physical';
        rows.push({
          id: this.rowId(category, r.id, r.orderId, it.productId, variantId, layer),
          category,
          orderId: r.orderId,
          orderDisplayId: order?.displayId ?? '',
          returnId: r.id,
          returnDisplayId: r.displayId,
          productId: it.productId,
          productName: product?.name ?? it.productId,
          variantId,
          layer,
          orderedQty,
          receivedGoodQty: good,
          damagedQty: damaged,
          alreadyRestoredManaged: restoredManaged,
          alreadyRestoredPhysical: restoredPhysical,
          missingManagedQty: missingManaged,
          missingPhysicalQty: missingPhysicalApplied,
          evidence:
            `return status=${r.status} stockReconciled=${r.stockReconciled}; ` +
            `managed RETURN ledger Σ=${restoredManaged} (ref return-${r.id} + blanket return-${r.orderId} Σ=${blanketManaged}); ` +
            `physical RESTORATION Σ=${restoredPhysical} (reason return-${r.id} + blanket return-${r.orderId} Σ=${blanketPhysical}); ` +
            `mode=${mode} manageStock=${product?.manageStock ?? 'unknown'} imEnabled=${imEnabled}` +
            (missingPhysicalApplied < missingPhysical
              ? '; physical shortage not applicable (no reservation/deduction evidence) — managed layer only'
              : ''),
        });
      }
    }

    // ── R3: lingering managed flags on Cancelled/Returned orders ────────
    const r3Orders = await this.prisma.order.findMany({
      where: {
        trashedAt: null,
        status: { name: { in: ['Cancelled', 'Returned'] } },
      },
      select: {
        id: true,
        displayId: true,
        status: { select: { name: true } },
        items: {
          where: {
            OR: [{ managedStockReserved: true }, { managedStockDeducted: true }],
          },
          select: { productId: true, variantId: true, quantity: true },
        },
      },
    });
    for (const o of r3Orders) {
      for (const li of o.items) {
        if (!li.productId) continue; // combo parent line — components handled below
        rows.push({
          id: this.rowId('R3', null, o.id, li.productId, li.variantId ?? null, 'managed'),
          category: 'R3',
          orderId: o.id,
          orderDisplayId: o.displayId,
          returnId: null,
          returnDisplayId: null,
          productId: li.productId,
          productName: li.productId,
          variantId: li.variantId ?? null,
          layer: 'managed',
          orderedQty: li.quantity,
          receivedGoodQty: 0,
          damagedQty: 0,
          alreadyRestoredManaged: 0,
          alreadyRestoredPhysical: 0,
          missingManagedQty: 0,
          missingPhysicalQty: 0,
          evidence:
            `Order ${o.status.name} with lingering managed flags — owned by the ` +
            'normal receive path / healOrder; report only, never applied here.',
        });
      }
    }
    const r3Components = await this.prisma.orderItemComboComponent.findMany({
      where: {
        OR: [{ managedStockReserved: true }, { managedStockDeducted: true }],
        orderItem: {
          order: {
            trashedAt: null,
            status: { name: { in: ['Cancelled', 'Returned'] } },
          },
        },
      },
      select: {
        productId: true,
        variantId: true,
        totalQuantity: true,
        orderItem: {
          select: {
            orderId: true,
            order: { select: { displayId: true, status: { select: { name: true } } } },
          },
        },
      },
    });
    for (const c of r3Components) {
      if (!c.productId) continue;
      rows.push({
        id: this.rowId('R3', null, c.orderItem.orderId, c.productId, c.variantId ?? null, 'managed'),
        category: 'R3',
        orderId: c.orderItem.orderId,
        orderDisplayId: c.orderItem.order.displayId,
        returnId: null,
        returnDisplayId: null,
        productId: c.productId,
        productName: c.productId,
        variantId: c.variantId ?? null,
        layer: 'managed',
        orderedQty: c.totalQuantity,
        receivedGoodQty: 0,
        damagedQty: 0,
        alreadyRestoredManaged: 0,
        alreadyRestoredPhysical: 0,
        missingManagedQty: 0,
        missingPhysicalQty: 0,
        evidence:
          `Order ${c.orderItem.order.status.name} combo component with lingering ` +
          'managed flags — owned by the normal receive path / healOrder; report only.',
      });
    }

    // ── R4: courier-reported return with NO Return record at all ────────
    const returnedDispatches = await this.prisma.dispatch.findMany({
      where: { status: 'RETURNED' },
      select: { orderId: true },
    });
    const dispatchOrderIds = [
      ...new Set(
        returnedDispatches
          .map((d) => d.orderId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (dispatchOrderIds.length) {
      const withReturns = await this.prisma.return.findMany({
        where: { orderId: { in: dispatchOrderIds } },
        select: { orderId: true },
      });
      const covered = new Set(withReturns.map((r) => r.orderId));
      const orphans = dispatchOrderIds.filter((id) => !covered.has(id));
      if (orphans.length) {
        const orphanOrders = await this.prisma.order.findMany({
          where: { id: { in: orphans } },
          select: { id: true, displayId: true },
        });
        for (const o of orphanOrders) {
          rows.push({
            id: this.rowId('R4', null, o.id, '', null, 'managed'),
            category: 'R4',
            orderId: o.id,
            orderDisplayId: o.displayId,
            returnId: null,
            returnDisplayId: null,
            productId: '',
            productName: '(no return record)',
            variantId: null,
            layer: 'managed',
            orderedQty: 0,
            receivedGoodQty: 0,
            damagedQty: 0,
            alreadyRestoredManaged: 0,
            alreadyRestoredPhysical: 0,
            missingManagedQty: 0,
            missingPhysicalQty: 0,
            evidence:
              'Courier reports this order returned but NO Return/RTN record ' +
              'exists — shipped? returned? proof? Staff disposition required; ' +
              'never auto-applied.',
          });
        }
      }
    }

    // ── R6: stranded managed qty / mode-switch residue on IC products ──
    const icStrandedProducts = await this.prisma.product.findMany({
      where: { availabilityMode: 'INVENTORY_CONTROLLED' },
      select: {
        id: true,
        name: true,
        type: true,
        managedStockQuantity: true,
        variants: { select: { id: true, managedStockQuantity: true } },
      },
    });
    if (icStrandedProducts.length) {
      const icLedger = await this.prisma.managedStockLedger.findMany({
        where: { productId: { in: icStrandedProducts.map((p) => p.id) } },
        select: { productId: true, variantId: true, note: true, performedAt: true },
      });
      const ledgerByUnit = new Map<string, { note?: string | null; performedAt?: any }[]>();
      for (const e of icLedger) {
        const key = `${e.productId}|${e.variantId ?? ''}`;
        const arr = ledgerByUnit.get(key) ?? [];
        arr.push(e);
        ledgerByUnit.set(key, arr);
      }
      for (const p of icStrandedProducts) {
        const units: { variantId: string | null; qty: number }[] = [];
        if (p.type === 'variable') {
          for (const v of p.variants ?? []) {
            units.push({ variantId: v.id, qty: v.managedStockQuantity });
          }
          // The product row itself is also a unit when it carries qty
          // (the variable cleanup zeroes it, but a stranded residue
          // there is the same defect class).
          if (p.managedStockQuantity !== 0) {
            units.push({ variantId: null, qty: p.managedStockQuantity });
          }
        } else {
          // simple + combo hold their managed quantity on the product row
          units.push({ variantId: null, qty: p.managedStockQuantity });
        }
        for (const u of units) {
          const residue = computeManagedModeResidue(
            ledgerByUnit.get(`${p.id}|${u.variantId ?? ''}`) ?? [],
          );
          if (u.qty === 0 && !residue.residue) continue;
          const evidenceParts = [
            `mode=INVENTORY_CONTROLLED type=${p.type}`,
            u.qty !== 0
              ? `managedStockQuantity=${u.qty} ≠ 0 — stranded by a mode switch ` +
                'without cleanup (the pre-fix cleanup skipped qty ≤ 0, combos ' +
                'and the draft path)'
              : 'managedStockQuantity=0',
          ];
          if (residue.residue) {
            evidenceParts.push(
              `managed ledger residue: ${residue.laterEntries} managed entr` +
                `${residue.laterEntries === 1 ? 'y' : 'ies'} performed after the last ` +
                `mode-change entry (note '${MODE_CHANGE_TO_IC_NOTE_PREFIX}…'` +
                `${residue.lastModeChangeAt ? `, performedAt=${residue.lastModeChangeAt.toISOString()}` : ''}) ` +
                '— managed stock kept moving after the switch',
            );
          }
          rows.push({
            id: this.rowId('R6', null, '', p.id, u.variantId, 'managed'),
            category: 'R6',
            orderId: '',
            orderDisplayId: '',
            returnId: null,
            returnDisplayId: null,
            productId: p.id,
            productName: p.name,
            variantId: u.variantId,
            layer: 'managed',
            orderedQty: 0,
            receivedGoodQty: 0,
            damagedQty: 0,
            alreadyRestoredManaged: 0,
            alreadyRestoredPhysical: 0,
            missingManagedQty: 0,
            missingPhysicalQty: 0,
            strandedManagedQty: u.qty,
            evidence: evidenceParts.join('; '),
          });
        }
      }
    }

    // ── R7 (REPORT-ONLY): suspected legacy mirror copies in physical ──
    const mirrorCandidates = await this.prisma.physicalInventory.findMany({
      where: { quantity: { gt: 0 } },
      select: {
        id: true,
        productId: true,
        variantId: true,
        warehouseId: true,
        quantity: true,
      },
    });
    if (mirrorCandidates.length) {
      const [lots, physLedgerKeys] = await Promise.all([
        this.prisma.costingLot.findMany({
          select: { productId: true, variantId: true, warehouseId: true },
        }),
        this.prisma.physicalInventoryLedger.findMany({
          select: { productId: true, variantId: true, warehouseId: true },
        }),
      ]);
      const keyOf = (r: { productId: string; variantId: string | null; warehouseId: string }) =>
        `${r.productId}|${r.variantId ?? ''}|${r.warehouseId}`;
      const lotKeys = new Set(lots.map(keyOf));
      const ledgerKeys = new Set(physLedgerKeys.map(keyOf));
      const candidateProductIds = [
        ...new Set(mirrorCandidates.map((r) => r.productId)),
      ];
      const candidateProducts = await this.prisma.product.findMany({
        where: { id: { in: candidateProductIds } },
        select: { id: true, name: true },
      });
      const candidateNameById = new Map(candidateProducts.map((p) => [p.id, p.name]));
      for (const r of mirrorCandidates) {
        const key = keyOf(r);
        if (lotKeys.has(key) || ledgerKeys.has(key)) continue;
        rows.push({
          id: ['R7', r.productId, r.variantId ?? '', 'physical', r.warehouseId].join('|'),
          category: 'R7',
          orderId: '',
          orderDisplayId: '',
          returnId: null,
          returnDisplayId: null,
          productId: r.productId,
          productName: candidateNameById.get(r.productId) ?? r.productId,
          variantId: r.variantId ?? null,
          layer: 'physical',
          orderedQty: 0,
          receivedGoodQty: 0,
          damagedQty: 0,
          alreadyRestoredManaged: 0,
          alreadyRestoredPhysical: 0,
          missingManagedQty: 0,
          missingPhysicalQty: 0,
          physicalQty: r.quantity,
          warehouseId: r.warehouseId,
          evidence:
            `PhysicalInventory quantity=${r.quantity} in warehouse=${r.warehouseId} ` +
            'with NO CostingLot and NO PhysicalInventoryLedger row for this ' +
            'product|variant|warehouse — no legitimate origin record; suspected ' +
            'legacy mirror copy from the removed auto-mirror behaviour. ' +
            'Report only — never auto-applied; human disposition required.',
        });
      }
    }

    // ── R8: legacy orders with NO Return record (pre-Return-system) ────
    const legacyOrders = await this.prisma.order.findMany({
      where: {
        trashedAt: null,
        status: { name: { in: ['Return Pending', 'Returned', 'Damaged'] } },
      },
      select: {
        id: true,
        displayId: true,
        timeline: true,
        status: { select: { name: true } },
        items: { select: { productId: true, quantity: true } },
      },
    });
    if (legacyOrders.length) {
      const legacyIds = legacyOrders.map((o) => o.id);
      const [existingReturns, partialDispatches] = await Promise.all([
        this.prisma.return.findMany({
          where: { orderId: { in: legacyIds } },
          select: { orderId: true },
        }),
        this.prisma.dispatch.findMany({
          where: { orderId: { in: legacyIds }, status: 'PARTIAL' },
          select: { orderId: true },
        }),
      ]);
      const returnCovered = new Set(existingReturns.map((r) => r.orderId));
      const partialDispatchOrders = new Set(partialDispatches.map((d) => d.orderId));
      for (const o of legacyOrders) {
        if (returnCovered.has(o.id)) continue; // idempotency key: a Return row exists
        const statusName = (o.status as any)?.name ?? '';
        const entries: any[] = Array.isArray(o.timeline) ? (o.timeline as any[]) : [];
        const hasReturnedEntry = entries.some((e) => e?.status === 'Returned');
        // A Damaged order that never passed through Returned is not a
        // legacy-return candidate (damage-only flow, no return happened).
        if (statusName === 'Damaged' && !hasReturnedEntry) continue;
        let cls = this.classifyLegacyReturn({ statusName, timeline: o.timeline });
        if (cls.kind !== 'human' && partialDispatchOrders.has(o.id)) {
          cls = {
            ...cls,
            kind: 'human',
            reason:
              'a dispatch for this order is PARTIAL — the legacy return may ' +
              'not have been full-order, so the returned quantities are ambiguous',
          };
        }
        if (cls.kind !== 'human' && (!o.items || o.items.length === 0)) {
          cls = {
            ...cls,
            kind: 'human',
            reason: 'the order has no lines — returned quantities are unknowable',
          };
        }
        const decisiveAt =
          cls.kind === 'terminal' ? cls.returnedAt : cls.kind === 'pending' ? cls.pendingAt : null;
        const evidence =
          cls.kind === 'human'
            ? `R8-H (report-only): order status=${statusName}, NO Return record. ${cls.reason}. Never auto-backfilled.`
            : cls.kind === 'terminal'
              ? `order status=Returned; timeline 'Returned' transition at ` +
                `${cls.returnedAt?.toISOString()} (performedBy=${cls.actor ?? 'unknown'}); ` +
                'NO Return record — legacy pre-Return-system return. Backfill ' +
                'creates a RESTOCKED + stockReconciled Return (receivedAt = the ' +
                'historical transition date) with per-return evidence keys ' +
                '(return-<returnId>) and NO stock movement.'
              : `order status=Return Pending; timeline 'Return Pending' transition at ` +
                `${cls.pendingAt?.toISOString()} (performedBy=${cls.actor ?? 'unknown'}); ` +
                'NO Return record — legacy pre-Return-system return. Backfill ' +
                'creates a REQUESTED Return only; staff receive it through the ' +
                'normal manual flow (the script never marks a return received).';
        rows.push({
          id: this.rowId('R8', null, o.id, '', null, 'managed'),
          category: 'R8',
          r8Kind: cls.kind,
          legacyAt: decisiveAt?.toISOString(),
          legacyActor: cls.actor,
          orderId: o.id,
          orderDisplayId: o.displayId,
          returnId: null,
          returnDisplayId: null,
          productId: '',
          productName: '(legacy return — no Return record)',
          variantId: null,
          layer: 'managed',
          orderedQty: (o.items ?? []).reduce((s, li) => s + (li.quantity ?? 0), 0),
          receivedGoodQty: 0,
          damagedQty: 0,
          alreadyRestoredManaged: 0,
          alreadyRestoredPhysical: 0,
          missingManagedQty: 0,
          missingPhysicalQty: 0,
          evidence,
        });
      }
    }

    // ── R5: out-of-scope counts (no rows, no action) ────────────────────
    const [
      pendingReturns,
      damagedOrders,
      partialWithoutRecord,
      alwaysModeProducts,
      icProducts,
    ] = await Promise.all([
      this.prisma.return.count({
        where: { status: { in: ['REQUESTED', 'IN_TRANSIT', 'DELIVERED'] } },
      }),
      this.prisma.order.count({
        where: { trashedAt: null, status: { name: 'Damaged' } },
      }),
      this.prisma.return.count({
        where: {
          type: 'PARTIAL',
          status: { in: [...RECEIVED_RETURN_STATUSES] },
          items: { equals: [] },
        },
      }),
      this.prisma.product.count({
        where: {
          availabilityMode: { in: ['ALWAYS_IN_STOCK', 'ALWAYS_OUT_OF_STOCK'] },
        },
      }),
      this.prisma.product.count({
        where: { availabilityMode: 'INVENTORY_CONTROLLED' },
      }),
    ]);
    const r5: Record<string, number> = {
      returnPending: pendingReturns,
      damaged: damagedOrders,
      partialWithoutRecord,
      alwaysMode: alwaysModeProducts,
    };
    if (!imEnabled) r5['imOffInventoryControlled'] = icProducts;

    // ── Q1–Q8 verification set ──────────────────────────────────────────
    const checks: ReconCheck[] = [];
    const missingManagedRows = rows.filter((r) => r.missingManagedQty > 0);
    const missingPhysicalRows = rows.filter((r) => r.missingPhysicalQty > 0);
    checks.push({
      key: 'Q1',
      label: 'Received returns without a matching managed RETURN ledger add',
      value: missingManagedRows.length,
      pass: missingManagedRows.length === 0,
      detail:
        'R1/R2 rows with missingManagedQty > 0 (R4 rows carry no quantity and are excluded by design).',
    });
    checks.push({
      key: 'Q2',
      label: 'Received returns without a matching physical RESTORATION (IM on, MANAGED_STOCK / INVENTORY_CONTROLLED)',
      value: missingPhysicalRows.length,
      pass: missingPhysicalRows.length === 0,
      detail: imEnabled
        ? 'R1/R2 rows with missingPhysicalQty > 0.'
        : 'IM is OFF on this stack — physical layer not applicable.',
    });

    // Q3 — negative available (managed products + variants, physical rows)
    const [negProducts, negVariants, negPhysical] = await Promise.all([
      this.prisma.product.findMany({
        where: { availabilityMode: 'MANAGED_STOCK' },
        select: { managedStockQuantity: true, reservedStock: true },
      }),
      this.prisma.productVariant.findMany({
        select: { managedStockQuantity: true, reservedStock: true },
      }),
      this.prisma.physicalInventory.findMany({
        select: { quantity: true, reservedQuantity: true },
      }),
    ]);
    const negCount =
      negProducts.filter((p) => p.managedStockQuantity - p.reservedStock < 0).length +
      negVariants.filter((v) => v.managedStockQuantity - v.reservedStock < 0).length +
      negPhysical.filter((p) => p.quantity - p.reservedQuantity < 0).length;
    checks.push({
      key: 'Q3',
      label: 'Negative available anywhere (quantity − reserved < 0)',
      value: negCount,
      pass: negCount === 0,
      detail: 'Managed products + variants and physical rows combined.',
    });

    // Q4 — managed/physical divergence (list only, never auto-fixed)
    let q4Detail = 'IM is OFF — managed-only scope, no physical layer to diverge from.';
    let q4Value = 0;
    if (imEnabled) {
      const managedProducts = await this.prisma.product.findMany({
        where: { availabilityMode: 'MANAGED_STOCK' },
        select: {
          id: true,
          name: true,
          managedStockQuantity: true,
          variants: { select: { managedStockQuantity: true } },
        },
      });
      const phys = await this.prisma.physicalInventory.findMany({
        select: { productId: true, quantity: true },
      });
      const physByProduct = new Map<string, number>();
      for (const p of phys) {
        physByProduct.set(p.productId, (physByProduct.get(p.productId) ?? 0) + p.quantity);
      }
      const divergent: string[] = [];
      for (const p of managedProducts) {
        const managed =
          p.variants.length > 0
            ? p.variants.reduce((s, v) => s + v.managedStockQuantity, 0)
            : p.managedStockQuantity;
        const physical = physByProduct.get(p.id) ?? 0;
        if (managed !== physical) {
          q4Value++;
          if (divergent.length < 50) {
            divergent.push(`${p.name}: managed=${managed} physical=${physical}`);
          }
        }
      }
      q4Detail =
        'Divergence can be expected when sync is off — the question is whether ' +
        'it matches the product sync behaviour, not whether it is zero. ' +
        (divergent.length ? divergent.join('; ') : 'No divergent products.');
    }
    checks.push({
      key: 'Q4',
      label: 'Managed/physical divergence for MANAGED_STOCK + IM ON products (list only)',
      value: q4Value,
      pass: null,
      detail: q4Detail,
    });

    // Q5 — lingering flags on terminal orders (the S1 drift scan, read-only)
    const drifted = await this.reconciliation.scanDriftedOrders();
    checks.push({
      key: 'Q5',
      label: 'Terminal/partial orders with lingering stock flags (S1 drift scan)',
      value: drifted.length,
      pass: drifted.length === 0,
      detail:
        drifted
          .slice(0, 50)
          .map((d) => `${d.id} (${d.statusName})`)
          .join('; ') || 'None.',
    });

    // Q6 — ACTIVE physical reservations on terminal orders
    const [activeRes, activeComboRes] = await Promise.all([
      this.prisma.physicalReservation.findMany({
        where: { status: 'ACTIVE' },
        select: { orderId: true },
      }),
      this.prisma.comboComponentPhysicalReservation.findMany({
        where: { status: 'ACTIVE' },
        select: { orderId: true },
      }),
    ]);
    const activeOrderIds = [
      ...new Set([
        ...activeRes.map((r) => r.orderId),
        ...activeComboRes.map((r) => r.orderId),
      ]),
    ];
    let q6Value = 0;
    if (activeOrderIds.length) {
      const terminal = await this.prisma.order.findMany({
        where: {
          id: { in: activeOrderIds },
          status: { name: { in: TERMINAL_ORDER_STATUSES } },
        },
        select: { id: true },
      });
      const terminalIds = new Set(terminal.map((o) => o.id));
      q6Value =
        activeRes.filter((r) => terminalIds.has(r.orderId)).length +
        activeComboRes.filter((r) => terminalIds.has(r.orderId)).length;
    }
    checks.push({
      key: 'Q6',
      label: 'ACTIVE physical reservations on terminal orders',
      value: q6Value,
      pass: q6Value === 0,
      detail: 'Reservations still ACTIVE although their order reached a terminal status.',
    });

    // Q7 — delivered lines still on estimated cost WITH a FULFILLMENT consumption
    const estimatedLines = await this.prisma.orderItem.findMany({
      where: {
        costType: 'estimated',
        order: { status: { name: 'Delivered' } },
      },
      select: { id: true, order: { select: { displayId: true } } },
      take: 500,
    });
    let q7Value = 0;
    const q7List: string[] = [];
    if (estimatedLines.length) {
      const consumptions = await this.prisma.costingLotConsumption.findMany({
        where: {
          type: 'FULFILLMENT',
          referenceType: 'ORDER_ITEM',
          referenceId: { in: estimatedLines.map((l) => l.id) },
        },
        select: { referenceId: true },
      });
      const consumedIds = new Set(consumptions.map((c) => c.referenceId));
      for (const l of estimatedLines) {
        if (consumedIds.has(l.id)) {
          q7Value++;
          if (q7List.length < 20) q7List.push(l.order.displayId);
        }
      }
    }
    checks.push({
      key: 'Q7',
      label: "Delivered lines with costType='estimated' where a FULFILLMENT consumption exists",
      value: q7Value,
      pass: null,
      detail:
        'Heal-skipped physical fulfills. Count + list only — rewriting cost ' +
        'history needs explicit owner approval (P&L). ' +
        (q7List.length ? `Orders: ${[...new Set(q7List)].join(', ')}` : ''),
    });

    // Q8 — ledger-vs-state verification re-run (S1 verifier, read-only)
    const [ledgerUnits, physUnits] = await Promise.all([
      this.prisma.managedStockLedger.findMany({
        select: { productId: true, variantId: true },
        distinct: ['productId', 'variantId'],
        take: 1000,
      }),
      this.prisma.physicalInventory.findMany({
        select: { productId: true, variantId: true },
        distinct: ['productId', 'variantId'],
        take: 1000,
      }),
    ]);
    const keySet = new Set<string>();
    for (const u of [...ledgerUnits, ...physUnits]) {
      if (u.productId) keySet.add(`p:${u.productId}|${u.variantId ?? ''}`);
    }
    const verification = await this.reconciliation.verifyStockIntegrity([...keySet]);
    checks.push({
      key: 'Q8',
      label: 'Ledger-vs-state verification re-run (S1 verifier)',
      value: verification.fail,
      pass: verification.fail === 0,
      detail:
        `checked=${verification.checked} pass=${verification.pass} fail=${verification.fail}. ` +
        'CAVEAT: PASS proves ledger/state agreement only, NOT semantic ' +
        'correctness — Q1/Q2 are the semantic proofs.',
    });

    const count = (c: ReconCategory) => rows.filter((r) => r.category === c).length;
    return {
      generatedAt: new Date().toISOString(),
      imEnabled,
      rows,
      counts: {
        R1: count('R1'),
        R2: count('R2'),
        R3: count('R3'),
        R4: count('R4'),
        R5: r5,
        R6: count('R6'),
        R7: count('R7'),
        R8: rows.filter((r) => r.category === 'R8' && r.r8Kind !== 'human').length,
        R8H: rows.filter((r) => r.category === 'R8' && r.r8Kind === 'human').length,
      },
      checks,
    };
  }
}
