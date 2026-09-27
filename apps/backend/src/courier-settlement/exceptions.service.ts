// ── Exception lifecycle (§15): open → acknowledged → resolved/waived.
//
// Exceptions are materialised from the frozen ruleset so reads are cheap; the
// ruleset remains the only source of severity/blocking. Acknowledging a YELLOW
// exception is what unblocks finalization when the require-warning-ack setting
// is on. RED exceptions can never be acknowledged away.

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CourierSettlementActivityService } from './activity.service';
import {
  evaluateRules,
  worstSeverity,
  type RuleContext,
  type RuleFinding,
} from './reconciliation/rules';

export interface MaterializeInput {
  invoiceId: string;
  rowId?: string | null;
  orderId?: string | null;
  dispatchId?: string | null;
  findings: RuleFinding[];
  context?: Record<string, unknown>;
}

@Injectable()
export class CourierSettlementExceptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: CourierSettlementActivityService,
  ) {}

  /** Replace the open exceptions for a row/invoice with the current findings.
   * Acknowledged exceptions are preserved so a re-analysis never silently
   * un-acknowledges a warning the operator already accepted. */
  async materialize(input: MaterializeInput): Promise<void> {
    const where = input.rowId
      ? { invoiceId: input.invoiceId, rowId: input.rowId }
      : { invoiceId: input.invoiceId, rowId: null as string | null, orderId: input.orderId ?? null };

    const existing = await this.prisma.courierSettlementException.findMany({ where });

    await this.prisma.$transaction(async (tx) => {
      // Drop exceptions whose rule no longer fires (a stale acknowledged warning
      // is also removed — it no longer describes the row). Acknowledged
      // exceptions that still fire are preserved so re-analysis never
      // un-acknowledges a warning the operator already accepted.
      for (const ex of existing) {
        const stillFires = input.findings.some((f) => f.id === ex.ruleId);
        if (!stillFires) {
          await tx.courierSettlementException.delete({ where: { id: ex.id } });
        }
      }
      for (const finding of input.findings) {
        const prior = existing.find((e) => e.ruleId === finding.id);
        const blocked = finding.blocking || finding.severity === 'red';
        if (prior) {
          await tx.courierSettlementException.update({
            where: { id: prior.id },
            data: {
              severity: finding.severity,
              blocked,
              message: finding.message,
              context: (input.context ?? {}) as never,
            },
          });
          continue;
        }
        await tx.courierSettlementException.create({
          data: {
            invoiceId: input.invoiceId,
            rowId: input.rowId ?? null,
            orderId: input.orderId ?? null,
            dispatchId: input.dispatchId ?? null,
            ruleId: finding.id,
            severity: finding.severity,
            blocked,
            status: 'open',
            message: finding.message,
            context: (input.context ?? {}) as never,
          },
        });
      }
    });
  }

  async acknowledge(invoiceId: string, exceptionId: string, actor?: string | null) {
    const ex = await this.prisma.courierSettlementException.findFirst({
      where: { id: exceptionId, invoiceId },
    });
    if (!ex) throw new NotFoundException('Exception not found');
    if (ex.severity === 'red') {
      // RED is blocking by definition; acknowledging it is not an escape hatch.
      throw new NotFoundException('Red exceptions cannot be acknowledged; resolve the underlying issue');
    }
    const updated = await this.prisma.courierSettlementException.update({
      where: { id: ex.id },
      data: { status: 'acknowledged', resolvedAt: new Date(), resolvedBy: actor ?? null },
    });
    // Acknowledging the last open warning can make the invoice finalizable.
    await this.refreshInvoiceState(invoiceId, actor);
    return updated;
  }

  /**
   * Import lands an invoice in ISSUE_FOUND / REVIEW_REQUIRED / READY_FOR_REVIEW
   * from its initial findings (§5 state machine). Resolving or re-evaluating
   * exceptions must be able to move it FORWARD again — otherwise an invoice
   * that once had a blocking finding could never be finalized even after the
   * issue was fixed. Only pre-finalize states are rewritten; financial states
   * are never touched by an exception refresh.
   */
  async refreshInvoiceState(invoiceId: string, actor?: string | null): Promise<string | null> {
    const invoice = await this.prisma.courierSettlementInvoice.findUnique({
      where: { id: invoiceId },
      select: { state: true },
    });
    if (!invoice) return null;
    const pre = [
      'UPLOADED',
      'ANALYZED',
      'MAPPING_REQUIRED',
      'IMPORTING',
      'READY_FOR_REVIEW',
      'REVIEW_REQUIRED',
      'ISSUE_FOUND',
    ];
    if (!pre.includes(invoice.state)) return null;

    const red = await this.prisma.courierSettlementException.count({
      where: { invoiceId, severity: 'red', status: 'open' },
    });
    const yellow = await this.prisma.courierSettlementException.count({
      where: { invoiceId, severity: 'yellow', status: 'open' },
    });
    const next = red > 0 ? 'ISSUE_FOUND' : yellow > 0 ? 'REVIEW_REQUIRED' : 'READY_FOR_REVIEW';
    if (next === invoice.state) return invoice.state;

    await this.prisma.courierSettlementInvoice.update({
      where: { id: invoiceId },
      data: { state: next as never },
    });
    await this.activity.record({
      invoiceId,
      action: 'EFFECTIVE_STATE_CHANGED',
      actor: actor ?? null,
      detail: { from: invoice.state, to: next, reason: 'exception re-evaluation' },
      dedupeKey: `state-refresh:${invoiceId}:${invoice.state}:${next}`,
    });
    return next;
  }

  /**
   * List exceptions. Scoped by invoice when `invoiceId` is given; otherwise the
   * cross-invoice work queue (the same population the overview KPI rolls up).
   * `status` narrows to the lifecycle state (`open` / `acknowledged` /
   * `resolved` / `waived`).
   */
  async list(invoiceId?: string, status?: string, take = 500, severity?: string) {
    // Cross-invoice work queue (Q6): every finding carries enough context to
    // drill straight to the invoice/row it belongs to — never a bare count.
    return this.prisma.courierSettlementException.findMany({
      where: {
        ...(invoiceId ? { invoiceId } : {}),
        ...(status ? { status } : {}),
        ...(severity ? { severity } : {}),
      },
      orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
      take: Math.min(Math.max(take, 1), 2000),
      select: {
        id: true,
        invoiceId: true,
        rowId: true,
        orderId: true,
        ruleId: true,
        severity: true,
        blocked: true,
        status: true,
        message: true,
        context: true,
        createdAt: true,
        resolvedAt: true,
        resolvedBy: true,
        invoice: {
          select: { displayId: true, courier: true, state: true, provider: true },
        },
        row: { select: { rowNumber: true, identifier: true, matchMethod: true } },
      },
    });
  }

  async openForInvoice(invoiceId: string) {
    return this.prisma.courierSettlementException.findMany({
      where: { invoiceId, status: 'open' },
    });
  }

  /** Evaluate the frozen ruleset for a single context and return the summary. */
  evaluate(ctx: RuleContext) {
    const findings = evaluateRules(ctx);
    return { findings, severity: worstSeverity(findings), blocking: findings.some((f) => f.blocking || f.severity === 'red') };
  }
}