// ── Adjustments (§8, §9, §10) — the 3 correction classes.
//
//   A. source/business correction → overrides identification fields only.
//   B. courier-cost correction    → effectiveCharges override + projection recompute.
//   C. settlement/net correction  → effectiveCollected/effectiveNet overrides.
//
// Every record is append-only (original preserved). A B/C correction posts a
// compensating journal from declared deltas; a ΔR ≠ 0 correction without a
// declared counterpart is rejected at validation. Raw values are never mutated.

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { CourierSettlementAccountingService } from './courier-settlement-accounting.service';
import { CourierSettlementActivityService } from './activity.service';
import { CourierSettlementCostService } from './cost-projection.service';
import { CourierSettlementReconciliationService } from './reconciliation.service';
import { CourierSettlementExceptionsService } from './exceptions.service';
import { buildCorrectionEntry, round2, type Counterpart } from './accounting/courier-accounting';
import { INVOICE_DISPLAY_PREFIX } from './courier-settlement.constants';
import { aggregateInvoiceTotals } from './snapshot.service';
import { evaluateRules } from './reconciliation/rules';

export type AdjustmentClass = 'source' | 'cost' | 'settlement';

export interface CreateAdjustmentInput {
  invoiceId: string;
  rowId?: string | null;
  adjustmentClass: AdjustmentClass;
  field: string;
  adjustedValue: string | number;
  reason?: string;
  counterpart?: Counterpart | null;
  actor?: string | null;
}

/**
 * Pre-finalize states: still in the review/ingest phase. Never rewritten to
 * ADJUSTED by a correction — only the exception refresh may move them.
 */
const PRE_FINALIZE_STATES = [
  'UPLOADED',
  'ANALYZED',
  'MAPPING_REQUIRED',
  'IMPORTING',
  'READY_FOR_REVIEW',
  'REVIEW_REQUIRED',
  'ISSUE_FOUND',
] as const;

@Injectable()
export class CourierSettlementAdjustmentsService {
  private readonly logger = new Logger(CourierSettlementAdjustmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: CourierSettlementAccountingService,
    private readonly activity: CourierSettlementActivityService,
    private readonly cost: CourierSettlementCostService,
    private readonly reconciliation: CourierSettlementReconciliationService,
    private readonly exceptions: CourierSettlementExceptionsService,
    private readonly cache?: CacheService,
  ) {}

  async create(input: CreateAdjustmentInput) {
    const invoice = await this.prisma.courierSettlementInvoice.findUnique({
      where: { id: input.invoiceId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const row = input.rowId
      ? await this.prisma.courierSettlementRow.findUnique({ where: { id: input.rowId } })
      : null;

    // Class A never touches money: identification fields are opaque strings
    // (tracking code, classification, delivery date), so they bypass parseMoney
    // — coercing 'TRK-123' through it would store 0 and destroy the value.
    if (input.adjustmentClass === 'source') {
      return this.createSourceAdjustment(input, row);
    }

    const before = this.readTarget(row, input.field);
    const adjusted = parseMoney(input.adjustedValue);
    const difference = round2(adjusted - before);

    if (input.adjustmentClass === 'cost') {
      return this.createCostAdjustment(input, invoice, row, before, adjusted, difference);
    }
    return this.createSettlementAdjustment(input, invoice, row, before, adjusted, difference);
  }

  /**
   * §8 class A — overrides identification fields only. Raw values are recorded
   * verbatim (no money coercion), no journal is posted, `difference` stays null
   * (the class carries no financial delta), and matching is re-run so a
   * corrected identifier can clear NO_MATCH (or drop a stale match).
   */
  private async createSourceAdjustment(
    input: CreateAdjustmentInput,
    row: Awaited<ReturnType<PrismaService['courierSettlementRow']['findUnique']>>,
  ) {
    const originalValue = readRawTarget(row, input.field);
    const adjustedValue = String(input.adjustedValue ?? '').trim();

    const record = await this.prisma.courierSettlementAdjustment.create({
      data: {
        invoiceId: input.invoiceId,
        rowId: input.rowId ?? null,
        adjustmentClass: 'source',
        field: input.field,
        originalValue,
        adjustedValue,
        difference: null,
        reason: input.reason ?? null,
        userId: input.actor ?? null,
      },
    });

    if (row) {
      const normalized = { ...((row.normalized as object) ?? {}) } as Record<string, unknown>;
      normalized[input.field] = adjustedValue;
      await this.prisma.courierSettlementRow.update({
        where: { id: row.id },
        data: {
          hasAdjustment: true,
          normalized: normalized as never,
          // consignmentId is a first-class column — keep it in sync so the
          // next match (and every index built from it) sees the correction.
          ...(input.field === 'consignmentId'
            ? { consignmentId: adjustedValue === '' ? null : adjustedValue }
            : {}),
        },
      });
      // §8 class A: "re-runs matching; may clear NO_MATCH".
      await this.reconciliation.rematchRow(row.id);
    }

    await this.afterCascade(input.invoiceId, input.actor, false);
    return record;
  }

  private async createCostAdjustment(
    input: CreateAdjustmentInput,
    invoice: { id: string; displayId: string },
    row: Awaited<ReturnType<PrismaService['courierSettlementRow']['findUnique']>>,
    before: number,
    adjusted: number,
    difference: number,
  ) {
    // For a cost correction the dependent side is declared explicitly.
    const counterpart: Counterpart | null =
      input.counterpart ?? (Math.abs(difference) > 0 ? null : 'net');
    const deltaC = difference;
    const deltaN = counterpart === 'net' ? round2(-difference) : 0;
    const deltaG = counterpart === 'gross' ? difference : 0;

    const validation = buildCorrectionEntry({
      deltaG,
      deltaC,
      deltaN,
      counterpart,
      residualThreshold: await this.threshold(),
    });
    if (validation.rejected) {
      throw new BadRequestException(validation.rejectionReason);
    }

    let journalEntryId: string | null = null;
    if (invoice) {
      const posted = await this.accounting.postCorrection({
        invoiceId: input.invoiceId,
        deltaG,
        deltaC,
        deltaN,
        counterpart,
        entryDate: this.accounting.dhakaEntryDate(),
        referenceNo: `${INVOICE_DISPLAY_PREFIX}-${invoice.displayId}-adj`,
        description: `Correction of ${invoice.displayId} (${input.field}, counterpart=${counterpart ?? 'none'})`,
        actor: input.actor ?? null,
      });
      journalEntryId = posted.journalEntryId;
    }

    const record = await this.prisma.courierSettlementAdjustment.create({
      data: {
        invoiceId: input.invoiceId,
        rowId: input.rowId ?? null,
        adjustmentClass: 'cost',
        field: input.field,
        originalValue: String(before),
        adjustedValue: String(adjusted),
        difference,
        reason: input.reason ?? null,
        counterpart,
        userId: input.actor ?? null,
        journalEntryId,
      },
    });

    if (row) {
      await this.prisma.courierSettlementRow.update({
        where: { id: row.id },
        data: {
          effectiveCharges: adjusted,
          effectiveResidual: round2(
            num(row.effectiveCollected) - adjusted - num(row.effectiveNet),
          ),
          hasAdjustment: true,
        },
      });
      if (row.orderId) await this.cost.writeBack(row.orderId, undefined, input.actor);
    }

    await this.afterCascade(input.invoiceId, input.actor, true);
    return record;
  }

  private async createSettlementAdjustment(
    input: CreateAdjustmentInput,
    invoice: { id: string; displayId: string },
    row: Awaited<ReturnType<PrismaService['courierSettlementRow']['findUnique']>>,
    before: number,
    adjusted: number,
    difference: number,
  ) {
    const isNet = input.field === 'effectiveNet' || input.field === 'net';
    const isCollected = input.field === 'effectiveCollected' || input.field === 'collected';
    const counterpart: Counterpart | null =
      input.counterpart ?? (isCollected ? 'gross' : null);
    const deltaN = isNet ? difference : 0;
    const deltaG = isCollected ? difference : 0;

    const validation = buildCorrectionEntry({
      deltaG,
      deltaC: 0,
      deltaN,
      counterpart,
      residualThreshold: await this.threshold(),
    });
    if (validation.rejected) {
      throw new BadRequestException(validation.rejectionReason);
    }

    const posted = await this.accounting.postCorrection({
      invoiceId: input.invoiceId,
      deltaG,
      deltaC: 0,
      deltaN,
      counterpart,
      entryDate: this.accounting.dhakaEntryDate(),
      referenceNo: `${INVOICE_DISPLAY_PREFIX}-${invoice.displayId}-adj`,
      description: `Correction of ${invoice.displayId} (${input.field}, counterpart=${counterpart ?? 'none'})`,
      actor: input.actor ?? null,
    });

    const record = await this.prisma.courierSettlementAdjustment.create({
      data: {
        invoiceId: input.invoiceId,
        rowId: input.rowId ?? null,
        adjustmentClass: 'settlement',
        field: input.field,
        originalValue: String(before),
        adjustedValue: String(adjusted),
        difference,
        reason: input.reason ?? null,
        counterpart,
        userId: input.actor ?? null,
        journalEntryId: posted.journalEntryId,
      },
    });

    if (row) {
      await this.prisma.courierSettlementRow.update({
        where: { id: row.id },
        data: {
          ...(isNet ? { effectiveNet: adjusted } : {}),
          ...(isCollected ? { effectiveCollected: adjusted } : {}),
          effectiveResidual: round2(
            (isCollected ? adjusted : num(row.effectiveCollected)) -
              num(row.effectiveCharges) -
              (isNet ? adjusted : num(row.effectiveNet)),
          ),
          hasAdjustment: true,
        },
      });
    }

    await this.afterCascade(input.invoiceId, input.actor, true);
    return record;
  }

  /** Reverse a prior correction: full compensating reversal, original preserved. */
  async reverse(adjustmentId: string, reason: string, actor?: string | null) {
    const original = await this.prisma.courierSettlementAdjustment.findUnique({
      where: { id: adjustmentId },
    });
    if (!original) throw new NotFoundException('Adjustment not found');
    if (original.reversedById) throw new BadRequestException('Adjustment already reversed');

    const invoice = await this.prisma.courierSettlementInvoice.findUnique({
      where: { id: original.invoiceId },
    });
    const difference = num(original.difference);
    const isNet = original.field === 'effectiveNet' || original.field === 'net';
    const isCollected = original.field === 'effectiveCollected' || original.field === 'collected';
    const isCost = original.adjustmentClass === 'cost';

    let journalEntryId: string | null = null;
    // Only reverse a journal that was actually posted. Class A posts none at
    // create time, so its reversal must not invent a compensating entry.
    if (original.journalEntryId) {
      const posted = await this.accounting.postCorrection({
        invoiceId: original.invoiceId,
        deltaG: isCollected ? -difference : 0,
        deltaC: isCost ? -difference : 0,
        deltaN: isNet ? (original.counterpart === 'net' ? difference : 0) : 0,
        counterpart: original.counterpart as Counterpart | null,
        entryDate: this.accounting.dhakaEntryDate(),
        referenceNo: `${INVOICE_DISPLAY_PREFIX}-${invoice?.displayId ?? original.invoiceId}-rev`,
        description: `Reversal of adjustment ${original.id} (${original.field})`,
        actor: actor ?? null,
      });
      journalEntryId = posted.journalEntryId;
    }

    const reversal = await this.prisma.courierSettlementAdjustment.create({
      data: {
        invoiceId: original.invoiceId,
        rowId: original.rowId,
        adjustmentClass: original.adjustmentClass,
        field: original.field,
        originalValue: original.adjustedValue,
        adjustedValue: original.originalValue,
        difference: round2(-difference),
        reason,
        counterpart: original.counterpart,
        userId: actor ?? null,
        journalEntryId,
        reversalOfId: original.id,
      },
    });
    await this.prisma.courierSettlementAdjustment.update({
      where: { id: original.id },
      data: { reversedById: reversal.id },
    });

    if (original.rowId) {
      const row = await this.prisma.courierSettlementRow.findUnique({ where: { id: original.rowId } });
      if (row) {
        const restored = isCost
          ? { effectiveCharges: num(row.effectiveCharges) - difference }
          : isNet
            ? { effectiveNet: num(row.effectiveNet) - difference }
            : { effectiveCollected: num(row.effectiveCollected) - difference };
        await this.prisma.courierSettlementRow.update({
          where: { id: row.id },
          data: { ...restored },
        });
        if (isCost && row.orderId) await this.cost.writeBack(row.orderId, undefined, actor);
      }
    }

    await this.afterCascade(original.invoiceId, actor, true);
    return reversal;
  }

  async list(invoiceId: string) {
    return this.prisma.courierSettlementAdjustment.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Recompute invoice counters + invalidate derived caches (§8.3). */
  private async afterCascade(invoiceId: string, actor: string | null | undefined, financial: boolean) {
    const adjustments = await this.prisma.courierSettlementAdjustment.count({
      where: { invoiceId, reversalOfId: null },
    });
    const current = await this.prisma.courierSettlementInvoice.findUnique({
      where: { id: invoiceId },
      select: { state: true },
    });
    const preFinalize = current
      ? (PRE_FINALIZE_STATES as readonly string[]).includes(current.state)
      : false;
    if (preFinalize) {
      // A correction made during review must not shove a pre-finalize invoice
      // into ADJUSTED (that state is not claimable and would strand it). Its
      // state stays a function of its open exceptions instead.
      await this.exceptions.refreshInvoiceState(invoiceId, actor);
    }

    // §16: the stored `effectiveTotals` column feeds the invoice LIST and the
    // accounting repair path — it must track the correction, or every surface
    // that reads the column shows pre-adjustment figures. Aggregate in the DB
    // (constant queries) instead of loading every row of the invoice.
    const { totals } = await aggregateInvoiceTotals(this.prisma, invoiceId);
    await this.prisma.courierSettlementInvoice.update({
      where: { id: invoiceId },
      data: {
        effectiveTotals: totals as never,
        ...(preFinalize ? {} : { state: 'ADJUSTED' }),
      },
    });
    await this.activity.record({
      invoiceId,
      action: 'ADJUSTED',
      actor: actor ?? null,
      detail: { adjustmentCount: adjustments },
    });
    if (financial) {
      try {
        await this.cache?.invalidateByPrefix('analytics:');
        await this.cache?.invalidateByPrefix('courier-settlement:');
      } catch {
        /* cache failure must not fail the adjustment */
      }
    }
  }

  private readTarget(
    row: { declaredCollected: unknown; declaredCharges: unknown; declaredNet: unknown; effectiveCollected: unknown; effectiveCharges: unknown; effectiveNet: unknown } | null,
    field: string,
  ): number {
    if (!row) return 0;
    const map: Record<string, unknown> = {
      collected: row.effectiveCollected,
      charges: row.effectiveCharges,
      net: row.effectiveNet,
      effectiveCollected: row.effectiveCollected,
      effectiveCharges: row.effectiveCharges,
      effectiveNet: row.effectiveNet,
      declaredCollected: row.declaredCollected,
      declaredCharges: row.declaredCharges,
      declaredNet: row.declaredNet,
    };
    return num(map[field]);
  }

  private async threshold(): Promise<number> {
    const s = await this.prisma.systemSetting.findUnique({
      where: { key: 'courier_settlement_residual_threshold' },
    });
    const v = Number(s?.value);
    return Number.isFinite(v) && v > 0 ? v : 100;
  }

  /** Validation helper surfaced to the UI: preview + rule findings. */
  previewCorrection(deltaG: number, deltaC: number, deltaN: number, counterpart: Counterpart | null) {
    const result = buildCorrectionEntry({ deltaG, deltaC, deltaN, counterpart });
    const findings = evaluateRules({
      scope: 'adjustment',
      correctionDeltaR: result.deltaR,
      correctionCounterpart: counterpart,
    });
    return { ...result, findings };
  }
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Raw (string) read of an identification field — the row column, else normalized. */
function readRawTarget(
  row: { normalized: unknown; consignmentId?: string | null } | null,
  field: string,
): string {
  if (!row) return '';
  const direct = (row as Record<string, unknown>)[field];
  const normalized = (row.normalized ?? {}) as Record<string, unknown>;
  const value = direct ?? normalized[field];
  if (value === null || value === undefined) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}
function parseMoney(v: string | number): number {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? round2(n) : 0;
}