// ── Reconciliation actions: manual match (audited) + finance-rule approval (§11).
//
// A manual match resolves an unmatched row to an order/dispatch and re-runs the
// row rules so NO_MATCH clears honestly. Finance rules are declarative only (no
// expression evaluation) and gate finalization for generic/unproven providers.

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CourierSettlementActivityService } from './activity.service';
import { CourierSettlementExceptionsService } from './exceptions.service';
import { CourierSettlementImportService } from './courier-settlement-import.service';
import { SUPPORTED_COURIERS } from '../courier-manager/courier-status-mapper';
import { evaluateRules } from './reconciliation/rules';
import {
  matchRow,
  emptyIndexes,
  norm,
  type MatchIndexes,
} from './reconciliation/matcher';
import { getDescriptor } from './parsing/descriptors';
import { round2 } from './economics';
import type { Provider } from './parsing/types';

@Injectable()
export class CourierSettlementReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: CourierSettlementActivityService,
    private readonly exceptions: CourierSettlementExceptionsService,
    private readonly importer: CourierSettlementImportService,
  ) {}

  async manualMatch(rowId: string, orderId: string, reason: string | undefined, actor?: string | null) {
    const row = await this.prisma.courierSettlementRow.findUnique({ where: { id: rowId } });
    if (!row) throw new NotFoundException('Row not found');
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, displayId: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    await this.prisma.courierSettlementRow.update({
      where: { id: rowId },
      data: {
        orderId,
        matchMethod: 'MANUAL',
        matchedAt: new Date(),
        matchContext: { manualBy: actor ?? null, reason: reason ?? null, orderDisplayId: order.displayId } as never,
      },
    });

    // Clear the NO_MATCH exception for this row (it no longer applies).
    await this.prisma.courierSettlementException.deleteMany({
      where: { rowId, ruleId: 'NO_MATCH', status: { not: 'acknowledged' } },
    });
    await this.activity.record({
      invoiceId: row.invoiceId,
      action: 'MATCHED',
      actor: actor ?? null,
      detail: { rowNumber: row.rowNumber, orderId, manual: true, reason: reason ?? null },
    });
    await this.exceptions.refreshInvoiceState(row.invoiceId, actor);
    return this.prisma.courierSettlementRow.findUnique({ where: { id: rowId } });
  }

  /**
   * Re-run automatic matching for a row from its CURRENT identification fields
   * (§8 class A: "re-runs matching; may clear NO_MATCH"). A corrected tracking
   * code can resolve a NO_MATCH, and a bad correction can drop a stale match —
   * either way the rules are re-evaluated afterwards so the review state is
   * derived, never assumed.
   */
  async rematchRow(rowId: string) {
    const row = await this.prisma.courierSettlementRow.findUnique({
      where: { id: rowId },
      include: { invoice: { select: { provider: true } } },
    });
    if (!row) throw new NotFoundException('Row not found');

    const normalized = (row.normalized ?? {}) as Record<string, unknown>;
    const identifier = {
      rowNumber: row.rowNumber,
      consignmentId: row.consignmentId,
      displayId: str(normalized.displayId),
      trackingCode: str(normalized.trackingCode),
    };
    const indexes = await this.buildIndexesFor(identifier);
    const match = matchRow(
      identifier,
      getDescriptor((row.invoice.provider ?? 'generic') as Provider).identifierOrder,
      indexes,
    );

    await this.prisma.courierSettlementRow.update({
      where: { id: rowId },
      data: {
        matchMethod: match.matchMethod,
        matchContext: match.matchContext as never,
        orderId: match.orderId ?? null,
        dispatchId: match.dispatchId ?? null,
        matchedAt: match.matchMethod !== 'NONE' ? new Date() : null,
      },
    });
    if (match.matchMethod !== 'NONE') {
      await this.activity.record({
        invoiceId: row.invoiceId,
        action: 'MATCHED',
        actor: null,
        detail: { rowNumber: row.rowNumber, orderId: match.orderId ?? null, auto: true, method: match.matchMethod },
      });
    }
    return this.revalidateRow(rowId);
  }

  /** Targeted index build for one row's identifiers (no per-row N+1 elsewhere). */
  private async buildIndexesFor(identifier: {
    consignmentId?: string | null;
    displayId?: string | null;
    trackingCode?: string | null;
  }): Promise<MatchIndexes> {
    const indexes = emptyIndexes();
    const consignments = [identifier.consignmentId].filter(Boolean) as string[];
    const displayIds = [identifier.displayId].filter(Boolean) as string[];
    const trackings = [identifier.trackingCode].filter(Boolean) as string[];
    if (
      consignments.length === 0 &&
      displayIds.length === 0 &&
      trackings.length === 0
    ) {
      return indexes;
    }

    const dispatches = await this.prisma.dispatch.findMany({
      where: {
        OR: [
          consignments.length ? { consignmentId: { in: consignments } } : undefined,
          trackings.length ? { trackingCode: { in: trackings } } : undefined,
        ].filter(Boolean) as never,
      },
      select: { id: true, orderId: true, consignmentId: true, trackingCode: true },
    });
    for (const d of dispatches) {
      if (d.consignmentId) indexes.dispatchByConsignment.set(norm(d.consignmentId), { id: d.id, orderId: d.orderId });
      if (d.trackingCode) indexes.dispatchByTracking.set(norm(d.trackingCode), { id: d.id, orderId: d.orderId });
    }

    const orders = await this.prisma.order.findMany({
      where: {
        OR: [
          displayIds.length ? { displayId: { in: displayIds } } : undefined,
          consignments.length ? { courierConsignmentId: { in: consignments } } : undefined,
          trackings.length ? { courierTrackingCode: { in: trackings } } : undefined,
        ].filter(Boolean) as never,
      },
      select: {
        id: true,
        displayId: true,
        courierConsignmentId: true,
        courierTrackingCode: true,
      },
    });
    for (const o of orders) {
      if (o.displayId) indexes.orderByDisplayId.set(norm(o.displayId), { id: o.id });
      if (o.courierConsignmentId) indexes.orderByConsignment.set(norm(o.courierConsignmentId), { id: o.id });
      if (o.courierTrackingCode) indexes.orderByTracking.set(norm(o.courierTrackingCode), { id: o.id });
    }
    return indexes;
  }

  /** Re-run the rule evaluation for a row against its current persisted state. */
  async revalidateRow(rowId: string) {
    const row = await this.prisma.courierSettlementRow.findUnique({
      where: { id: rowId },
      include: { invoice: { select: { provider: true } } },
    });
    if (!row) throw new NotFoundException('Row not found');
    const findings = evaluateRules({
      scope: 'row',
      provider: row.invoice.provider as Provider,
      rowClass: row.rowClass,
      rowKind: row.rowKind,
      hasIdentifier: !!row.identifier,
      matched: row.matchMethod !== 'NONE',
      residual: num(row.declaredResidual),
      arithmeticDelta: 0,
      declaredCharges: num(row.declaredCharges),
      effectiveCollected: num(row.effectiveCollected),
      effectiveNet: num(row.effectiveNet),
    });
    await this.exceptions.materialize({
      invoiceId: row.invoiceId,
      rowId: row.id,
      orderId: row.orderId,
      dispatchId: row.dispatchId,
      findings,
    });
    await this.exceptions.refreshInvoiceState(row.invoiceId);
    return findings;
  }

  /** Approve a declarative finance rule (§11). Every approval is a new version. */
  async approveFinanceRule(input: {
    courier: string;
    format?: string;
    netRule: string;
    chargeComponents?: unknown;
    residualThreshold?: number;
    tolerance?: number;
    identifierOrder?: unknown;
    note?: string;
    actor?: string | null;
  }) {
    const allowed = ['declared_field', 'collected_minus_charges', 'billing_when_no_collection', 'component_sum'];
    if (!allowed.includes(input.netRule)) {
      throw new BadRequestException(`netRule must be one of ${allowed.join(', ')}`);
    }
    // Part 5: the courier is a configured value, never free text. A typo used
    // to create a rule that silently never matched any invoice.
    if (!(SUPPORTED_COURIERS as readonly string[]).includes(input.courier)) {
      throw new BadRequestException(
        `Unknown courier "${input.courier}". Supported couriers: ${SUPPORTED_COURIERS.join(', ')}.`,
      );
    }
    const credentials = (this.prisma as any).courierCredentials;
    if (credentials?.findFirst) {
      const configured = await credentials.findFirst({
        where: { courier: input.courier, enabled: true },
        select: { id: true },
      });
      if (!configured) {
        throw new BadRequestException(
          `Courier "${input.courier}" is not enabled. Enable it in Settings → Couriers before approving a settlement rule.`,
        );
      }
    }
    const existing = await this.prisma.courierSettlementFinanceRule.findFirst({
      where: { courier: input.courier, format: input.format ?? null },
    });
    const data = {
      netRule: input.netRule,
      chargeComponents: (input.chargeComponents ?? []) as never,
      identifierOrder: (input.identifierOrder ?? []) as never,
      residualThreshold: input.residualThreshold ?? 100,
      tolerance: input.tolerance ?? 1,
      note: input.note ?? null,
      approved: true,
      approvedById: input.actor ?? null,
      approvedAt: new Date(),
    };
    if (existing) {
      // §12: archive the superseded configuration under its current version so
      // a finalized invoice's rule version stays reconstructible, then bump.
      await this.prisma.courierSettlementFinanceRuleVersion.create({
        data: {
          ruleId: existing.id,
          version: existing.version,
          snapshot: ruleSnapshotOf(existing),
          approvedById: existing.approvedById,
          approvedAt: existing.approvedAt,
        },
      });
      return this.prisma.courierSettlementFinanceRule.update({
        where: { id: existing.id },
        data: { ...data, version: { increment: 1 } },
      });
    }
    return this.prisma.courierSettlementFinanceRule.create({
      data: { courier: input.courier, format: input.format ?? null, version: 1, ...data },
    });
  }

  async listFinanceRules() {
    return this.prisma.courierSettlementFinanceRule.findMany({
      orderBy: [{ courier: 'asc' }, { format: 'asc' }],
      include: {
        versions: {
          orderBy: { version: 'asc' },
          select: { version: true, snapshot: true, approvedById: true, approvedAt: true, createdAt: true },
        },
      },
    });
  }

  /**
   * §12 — "Test against sample rows" before approval. Pure arithmetic over the
   * candidate rule + numbers the operator pastes in; no stored invoice formula
   * is ever evaluated (rules stay declarative).
   */
  testFinanceRule(input: {
    netRule: string;
    chargeComponents?: unknown;
    residualThreshold?: number;
    tolerance?: number;
    sample?: Record<string, unknown>;
  }) {
    const sample = input.sample ?? {};
    const collected = num(sample['collected']);
    const tolerance = num(input.tolerance) || 1;
    const threshold = num(input.residualThreshold) || 100;
    const components = Array.isArray(input.chargeComponents)
      ? (input.chargeComponents as { header?: string; field?: string; sign?: number }[])
      : [];
    const componentValues = (sample['components'] ?? {}) as Record<string, unknown>;
    const declaredNet = sample['net'] == null ? null : num(sample['net']);
    const billing = sample['billing'] == null ? null : num(sample['billing']);

    let charges: number;
    if (componentValues && components.length > 0 && Object.keys(componentValues).length > 0) {
      charges = components.reduce((acc, c) => {
        const key = c.header ?? c.field ?? '';
        return acc + Number(c.sign ?? 1) * num(componentValues[key]);
      }, 0);
    } else {
      charges = num(sample['charges']);
    }

    let net: number | null = null;
    let proven = true;
    let explanation = '';
    switch (input.netRule) {
      case 'declared_field':
        net = declaredNet;
        explanation =
          net == null
            ? 'declared_field needs the sample payout/net value.'
            : 'Net is the provider-declared payout exactly as pasted.';
        if (net == null) proven = false;
        break;
      case 'collected_minus_charges':
        net = round2(collected - charges);
        explanation = `Net = collected (${collected}) − charges (${charges}).`;
        break;
      case 'component_sum':
        net = round2(collected - charges);
        explanation = `Charges = Σ signed components (${charges}); net = collected − charges.`;
        break;
      case 'billing_when_no_collection':
        if (collected > 0) {
          proven = false;
          explanation =
            'billing_when_no_collection is fail-closed: collected > 0 makes this branch unproven (net blocked).';
        } else if (collected === 0 && billing != null) {
          net = -billing;
          explanation = `Net = −billing (${billing}) with no collection.`;
        } else {
          proven = false;
          explanation = 'collected must be 0 or the billing value must be provided.';
        }
        break;
      default:
        proven = false;
        explanation = `Unknown netRule "${input.netRule}".`;
    }

    if (net == null) {
      return { ok: false, proven, charges, net: null, residual: null, severity: null, explanation };
    }
    const residual = round2(collected - charges - net);
    const abs = Math.abs(residual);
    const severity = abs <= tolerance ? 'ok' : abs <= threshold ? 'yellow' : 'red';
    return {
      ok: proven && severity === 'ok',
      proven,
      charges: round2(charges),
      net: round2(net),
      residual,
      severity,
      explanation:
        severity === 'ok'
          ? `${explanation} Residual ${residual} is within tolerance ±${tolerance}.`
          : `${explanation} Residual ${residual} exceeds tolerance ±${tolerance} (${severity === 'red' ? 'red' : 'yellow'}).`,
    };
  }
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
/** Identification fields are opaque strings — never coerced to a number. */
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Full configuration snapshot archived on each superseded rule version (§12). */
function ruleSnapshotOf(rule: {
  courier: string;
  format: string | null;
  netRule: string;
  chargeComponents: unknown;
  residualThreshold: unknown;
  tolerance: unknown;
  identifierOrder: unknown;
  note: string | null;
}) {
  return {
    courier: rule.courier,
    format: rule.format,
    netRule: rule.netRule,
    chargeComponents: rule.chargeComponents ?? [],
    residualThreshold: Number(rule.residualThreshold ?? 0),
    tolerance: Number(rule.tolerance ?? 0),
    identifierOrder: rule.identifierOrder ?? [],
    note: rule.note,
  };
}
