// ── Finalization (§5, §6, §7, §14.2): CAS claim → atomic tx → accounting post.
//
// Exactly-once is enforced by a CAS state transition (count === 1) plus unique
// constraints. RED rules always block; YELLOW rules block until acknowledged
// when the setting is on. The snapshot is written inside the same transaction,
// so it always matches the finalized figures. Accounting posts AFTER the tx, and
// its failure is surfaced honestly (ACCOUNTING_FAILED + Repair) — never a
// misleading success state.

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CourierSettlementSettingsService } from './courier-settlement-settings.service';
import { CourierSettlementAccountingService } from './courier-settlement-accounting.service';
import { CourierSettlementCostService } from './cost-projection.service';
import { FINALIZED_INVOICE_STATES } from './cost-projection';
import { CourierSettlementActivityService } from './activity.service';
import { computeInvoiceTotals } from './snapshot.service';
import {
  FINALIZING_STALE_MS,
  INVOICE_DISPLAY_PREFIX,
} from './courier-settlement.constants';

const CLAIMABLE_STATES = ['READY_FOR_REVIEW', 'REVIEW_REQUIRED'] as const;

export interface FinalizeResult {
  invoiceId: string;
  state: string;
  accountingStatus: string;
  journalEntryId: string | null;
  totals: ReturnType<typeof computeInvoiceTotals>;
  warnings: string[];
  costWrites: number;
}

@Injectable()
export class CourierSettlementFinalizeService {
  private readonly logger = new Logger(CourierSettlementFinalizeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CourierSettlementSettingsService,
    private readonly accounting: CourierSettlementAccountingService,
    private readonly cost: CourierSettlementCostService,
    private readonly activity: CourierSettlementActivityService,
  ) {}

  /** Reclaim a stale FINALIZING invoice (>15 min) — audited. */
  async reclaimStale(invoiceId: string, actor?: string | null): Promise<boolean> {
    const invoice = await this.prisma.courierSettlementInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.state !== 'FINALIZING') return false;
    const started = invoice.finalizingStartedAt?.getTime() ?? 0;
    if (Date.now() - started < FINALIZING_STALE_MS) return false;
    await this.prisma.courierSettlementInvoice.update({
      where: { id: invoiceId },
      data: { state: 'READY_FOR_REVIEW', finalizingToken: null, finalizingStartedAt: null },
    });
    await this.activity.record({
      invoiceId,
      action: 'EFFECTIVE_STATE_CHANGED',
      actor: actor ?? null,
      detail: { reclaimedStaleFinalizing: true },
    });
    return true;
  }

  async finalize(invoiceId: string, actor?: string | null): Promise<FinalizeResult> {
    const invoice = await this.prisma.courierSettlementInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.state === 'FINALIZING') {
      throw new ConflictException('Invoice is already being finalized');
    }
    if (!CLAIMABLE_STATES.includes(invoice.state as (typeof CLAIMABLE_STATES)[number])) {
      throw new ConflictException(`Invoice in state ${invoice.state} cannot be finalized`);
    }

    // ── Gate: RED always blocks; YELLOW blocks until acknowledged when required.
    // Only the blocking rule ids are fetched (DB-side filter) — a 5 000-row
    // invoice can carry 10k+ exceptions and the gate needs rule names, not rows.
    const [redRows, unackedRows] = await Promise.all([
      this.prisma.courierSettlementException.findMany({
        where: { invoiceId, severity: 'red' },
        select: { ruleId: true, severity: true },
      }),
      this.prisma.courierSettlementException.findMany({
        where: { invoiceId, severity: 'yellow', status: { not: 'acknowledged' } },
        select: { ruleId: true, severity: true, status: true },
      }),
    ]);
    const requireAck = await this.settings.requireWarningAck();
    const red = redRows.filter((e) => e.severity === 'red');
    const unacked = unackedRows.filter(
      (e) => e.severity === 'yellow' && e.status !== 'acknowledged',
    );
    if (red.length > 0) {
      throw new BadRequestException(
        `Blocking issues must be resolved before finalizing: ${red.map((e) => e.ruleId).join(', ')}`,
      );
    }
    if (requireAck && unacked.length > 0) {
      throw new BadRequestException(
        `Acknowledge warnings before finalizing: ${unacked.map((e) => e.ruleId).join(', ')}`,
      );
    }

    // ── CAS claim (exactly-once).
    const token = randomUUID();
    const claim = await this.prisma.courierSettlementInvoice.updateMany({
      where: { id: invoiceId, state: { in: [...CLAIMABLE_STATES] } },
      data: { state: 'FINALIZING', finalizingToken: token, finalizingStartedAt: new Date() },
    });
    if (claim.count !== 1) {
      throw new ConflictException('Invoice was finalized by another request');
    }

    let totals: ReturnType<typeof computeInvoiceTotals>;
    let costWrites = 0;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.courierSettlementRow.findMany({
          where: { invoiceId },
          orderBy: { rowNumber: 'asc' },
        });
        const computed = computeInvoiceTotals(
          rows.map((r) => ({
            rowClass: r.rowClass,
            supersededByRowId: r.supersededByRowId,
            effectiveCollected: num(r.effectiveCollected),
            effectiveCharges: num(r.effectiveCharges),
            effectiveNet: num(r.effectiveNet),
          })),
        );

        const version = (await tx.courierSettlementFinalizationSnapshot.count({ where: { invoiceId } })) + 1;
        await tx.courierSettlementFinalizationSnapshot.create({
          data: {
            invoiceId,
            version,
            takenById: actor ?? null,
            totals: computed as never,
            rows: rows.map((r) => ({
              rowNumber: r.rowNumber,
              rowClass: r.rowClass,
              rowKind: r.rowKind,
              consignmentId: r.consignmentId,
              orderId: r.orderId,
              matchMethod: r.matchMethod,
              declaredCollected: num(r.declaredCollected),
              declaredCharges: num(r.declaredCharges),
              declaredNet: num(r.declaredNet),
              effectiveCollected: num(r.effectiveCollected),
              effectiveCharges: num(r.effectiveCharges),
              effectiveNet: num(r.effectiveNet),
              reviewState: r.reviewState,
            })) as never,
          },
        });

        await tx.courierSettlementInvoice.update({
          where: { id: invoiceId },
          data: {
            state: 'FINALIZED_PENDING_ACCOUNTING',
            effectiveTotals: computed as never,
            finalizedAt: new Date(),
            finalizedBy: actor ?? null,
            finalizingToken: null,
            finalizingStartedAt: null,
            version: { increment: 1 },
          },
        });

        // ── Cost write-back per matched order (§7, absolute recompute).
        const orderIds = [
          ...new Set(
            rows
              .filter((r) => r.rowClass === 'DATA' && r.supersededByRowId == null && r.orderId)
              .map((r) => r.orderId as string),
          ),
        ];
        // Batched reads (rows + orders once for ALL orders), per-order writes.
        const written = await this.cost.writeBackMany(orderIds, tx as never, actor);
        const writes = written.length;

        return { computed, writes };
      });

      totals = result.computed;
      costWrites = result.writes;
    } catch (e) {
      // Transaction failed before commit → state unchanged (rollback). Release claim.
      await this.prisma.courierSettlementInvoice.updateMany({
        where: { id: invoiceId, finalizingToken: token },
        data: { state: 'READY_FOR_REVIEW', finalizingToken: null, finalizingStartedAt: null },
      });
      throw e;
    }

    await this.activity.record({
      invoiceId,
      action: 'SNAPSHOT_TAKEN',
      actor: actor ?? null,
      detail: { totals },
      dedupeKey: `snapshot:${invoice.version + 1}`,
    });
    await this.activity.record({
      invoiceId,
      action: 'FINALIZED',
      actor: actor ?? null,
      detail: { totals, costWrites },
      dedupeKey: `finalized:${invoice.version + 1}`,
    });

    // ── Accounting post (after commit; failure is honest, not fatal).
    const warnings: string[] = [];
    let journalEntryId: string | null = null;
    let accountingStatus = 'PENDING';
    let state: string = 'FINALIZED_PENDING_ACCOUNTING';

    const accountingEnabled = await this.accounting.isEnabled();
    if (!accountingEnabled) {
      accountingStatus = 'SKIPPED_ACCOUNTING_DISABLED';
      state = 'ACCOUNTING_SKIPPED_ACCOUNTING_DISABLED';
      await this.prisma.courierSettlementInvoice.update({
        where: { id: invoiceId },
        data: { accountingStatus: 'SKIPPED_ACCOUNTING_DISABLED', state: 'ACCOUNTING_SKIPPED_ACCOUNTING_DISABLED' },
      });
      warnings.push('Accounting is disabled; the invoice is finalized but no journal was posted.');
    } else {
      try {
        const posted = await this.accounting.postFinalization({
          invoiceId,
          gross: totals.collected,
          charges: totals.charges,
          net: totals.net,
          entryDate: invoice.finalizedAt ?? new Date(),
          referenceNo: `${INVOICE_DISPLAY_PREFIX}-${invoice.displayId}`,
          description: `Courier settlement ${invoice.displayId} (${invoice.courier})`,
          actor,
        });
        journalEntryId = posted.journalEntryId;
        accountingStatus = 'POSTED';
        state = 'ACCOUNTING_POSTED';
        await this.prisma.courierSettlementInvoice.update({
          where: { id: invoiceId },
          data: { accountingStatus: 'POSTED', state: 'ACCOUNTING_POSTED' },
        });
        await this.activity.record({
          invoiceId,
          action: 'POSTED_ACCOUNTING',
          actor: actor ?? null,
          detail: { journalEntryId, adopted: posted.adopted },
          dedupeKey: `posted:${journalEntryId}`,
        });
      } catch (e) {
        const message = (e as Error).message;
        await this.accounting.markFailure(invoiceId, message, actor);
        await this.prisma.courierSettlementInvoice.update({
          where: { id: invoiceId },
          data: { state: 'ACCOUNTING_FAILED' },
        });
        accountingStatus = 'FAILED';
        state = 'ACCOUNTING_FAILED';
        warnings.push(`Accounting posting failed: ${message}. Use Repair to retry.`);
      }
    }

    return {
      invoiceId,
      state,
      accountingStatus,
      journalEntryId,
      totals,
      warnings,
      costWrites,
    };
  }

  /**
   * Discard an invoice BEFORE finalization (§9/§15: deletion never happens —
   * the row stays for audit, stops being an obstacle for the duplicate-file
   * checksum lookup, and can no longer be finalized).
   */
  async discard(invoiceId: string, actor?: string | null, reason?: string) {
    const invoice = await this.prisma.courierSettlementInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.state === 'DISCARDED') {
      return { invoiceId, state: invoice.state as string, alreadyDiscarded: true };
    }
    if (invoice.state === 'FINALIZING') {
      throw new ConflictException('A finalization is in flight; reclaim it before discarding');
    }
    if ((FINALIZED_INVOICE_STATES as readonly string[]).includes(invoice.state)) {
      throw new ConflictException(
        `Invoice in state ${invoice.state} is financially finalized and cannot be discarded`,
      );
    }
    const updated = await this.prisma.courierSettlementInvoice.update({
      where: { id: invoiceId },
      data: { state: 'DISCARDED', finalizingToken: null },
    });
    await this.activity.record({
      invoiceId,
      action: 'DISCARDED',
      actor: actor ?? null,
      detail: { from: invoice.state, reason: reason ?? null },
      dedupeKey: `discarded:${invoiceId}:${invoice.state}`,
    });
    return { invoiceId, state: updated.state as string, alreadyDiscarded: false };
  }

  /**
   * Repair: idempotently re-attempt accounting posting. Adopts an existing
   * linked entry rather than duplicating it.
   */
  async repairAccounting(invoiceId: string, actor?: string | null): Promise<FinalizeResult> {
    const invoice = await this.prisma.courierSettlementInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.state !== 'ACCOUNTING_FAILED') {
      throw new ConflictException('Only an ACCOUNTING_FAILED invoice can be repaired');
    }
    const totals = (invoice.effectiveTotals as unknown as ReturnType<typeof computeInvoiceTotals>) ?? {
      collected: 0, charges: 0, net: 0, residual: 0, cashReceived: 0, cashDisbursed: 0,
    };
    const posted = await this.accounting.postFinalization({
      invoiceId,
      gross: totals.collected,
      charges: totals.charges,
      net: totals.net,
      entryDate: invoice.finalizedAt ?? new Date(),
      referenceNo: `${INVOICE_DISPLAY_PREFIX}-${invoice.displayId}`,
      description: `Courier settlement ${invoice.displayId} (${invoice.courier}) — repair`,
      actor,
    });
    await this.prisma.courierSettlementInvoice.update({
      where: { id: invoiceId },
      data: { state: 'ACCOUNTING_POSTED', accountingStatus: 'POSTED', accountingError: null },
    });
    await this.activity.record({
      invoiceId,
      action: 'ACCOUNTING_REPAIRED',
      actor: actor ?? null,
      detail: { journalEntryId: posted.journalEntryId, adopted: posted.adopted },
      dedupeKey: `repaired:${posted.journalEntryId}`,
    });
    return {
      invoiceId,
      state: 'ACCOUNTING_POSTED',
      accountingStatus: 'POSTED',
      journalEntryId: posted.journalEntryId,
      totals,
      warnings: [],
      costWrites: 0,
    };
  }
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}