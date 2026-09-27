// §5/§6/§7/§14.2 — finalization exit gates (P6): RED never bypasses, YELLOW
// blocks until acknowledged when required, the CAS claim makes exactly-once
// observable, the snapshot lands in the SAME transaction as the state change,
// a crashed transaction releases the claim (honest rollback, no silent skip),
// a failed accounting post is reported as ACCOUNTING_FAILED (never a misleading
// success), and the disabled-accounting path is disclosed instead of skipped.

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CourierSettlementFinalizeService } from '../courier-settlement-finalize.service';
import { CourierSettlementSettingsService } from '../courier-settlement-settings.service';
import { CourierSettlementAccountingService } from '../courier-settlement-accounting.service';
import { CourierSettlementCostService } from '../cost-projection.service';
import { CourierSettlementActivityService } from '../activity.service';
import { FINALIZING_STALE_MS } from '../courier-settlement.constants';

const DATA_ROW = {
  rowNumber: 1,
  rowClass: 'DATA',
  rowKind: 'STANDARD',
  consignmentId: 'DFRS1',
  orderId: 'ord-1',
  matchMethod: 'CONSIGNMENT',
  declaredCollected: 1000,
  declaredCharges: 100,
  declaredNet: 900,
  effectiveCollected: 1000,
  effectiveCharges: 100,
  effectiveNet: 900,
  supersededByRowId: null,
  reviewState: 'MATCHED',
};

type Overrides = {
  state?: string | null;
  exceptions?: unknown[];
  requireAck?: boolean;
  claimCount?: number;
  accountingEnabled?: boolean;
  postFails?: boolean;
  txFails?: boolean;
  version?: number;
};

async function makeService(o: Overrides = {}) {
  const state = o.state === undefined ? 'READY_FOR_REVIEW' : o.state;
  const exceptions = (o.exceptions ?? []) as any[];
  const rows = [DATA_ROW] as any[];
  let snapshotCount = 0;
  const created: any[] = [];

  const invoiceRow = {
    id: 'inv-1',
    displayId: 'CS-260927-0001',
    courier: 'pathao',
    state,
    version: o.version ?? 0,
    finalizedAt: null,
    finalizingToken: null,
    finalizingStartedAt: null,
  };

  const tx = {
    courierSettlementRow: { findMany: jest.fn().mockResolvedValue(rows) },
    courierSettlementFinalizationSnapshot: {
      count: jest.fn().mockImplementation(async () => snapshotCount),
      create: jest.fn().mockImplementation(async (args: any) => {
        snapshotCount += 1;
        created.push(args.data);
        return args.data;
      }),
    },
    courierSettlementInvoice: { update: jest.fn().mockResolvedValue(invoiceRow) },
  };

  const prisma: any = {
    courierSettlementInvoice: {
      findUnique: jest.fn().mockResolvedValue(state === null ? null : invoiceRow),
      updateMany: jest.fn().mockImplementation(async (args: any) => {
        // CAS: only claim when the where-clause still matches the live state.
        const where = args.where ?? {};
        const allowed: string[] = where.state?.in ?? [];
        if (allowed.length && (!allowed.includes(state as string) && !allowed.includes('FINALIZING'))) {
          return { count: 0 };
        }
        return { count: o.claimCount ?? 1 };
      }),
      update: jest.fn().mockResolvedValue(invoiceRow),
    },
    courierSettlementException: {
      findMany: jest.fn().mockResolvedValue(exceptions),
    },
    $transaction: jest.fn().mockImplementation(async (fn: any) => {
      if (o.txFails) throw new Error('write conflict in transaction');
      return fn(tx);
    }),
  };

  const activity = { record: jest.fn().mockResolvedValue(undefined) };
  const settings = {
    requireWarningAck: jest.fn().mockResolvedValue(o.requireAck ?? false),
  };
  const accounting = {
    isEnabled: jest.fn().mockResolvedValue(o.accountingEnabled ?? true),
    postFinalization: jest
      .fn()
      .mockImplementation(async () => {
        if (o.postFails) throw new Error('journal sequence unavailable');
        return { journalEntryId: 'je-1', adopted: false };
      }),
    markFailure: jest.fn().mockResolvedValue(undefined),
  };
  const cost = {
    writeBack: jest.fn().mockResolvedValue({ written: true }),
    writeBackMany: jest.fn().mockResolvedValue([{ orderId: 'ord-1' }]),
  };

  const mod = await Test.createTestingModule({
    providers: [
      CourierSettlementFinalizeService,
      { provide: PrismaService, useValue: prisma },
      { provide: CourierSettlementSettingsService, useValue: settings },
      { provide: CourierSettlementAccountingService, useValue: accounting },
      { provide: CourierSettlementCostService, useValue: cost },
      { provide: CourierSettlementActivityService, useValue: activity },
    ],
  }).compile();

  return {
    svc: mod.get(CourierSettlementFinalizeService),
    prisma,
    tx,
    activity,
    settings,
    accounting,
    cost,
    created,
    getSnapshotCount: () => snapshotCount,
  };
}

describe('CourierSettlementFinalizeService.finalize (§5/§6/§7 — P6 gates)', () => {
  it('refuses to finalize while any RED exception is open (no bypass)', async () => {
    const ctx = await makeService({
      exceptions: [{ ruleId: 'OVER_SETTLEMENT', severity: 'red', status: 'open' }],
    });
    await expect(ctx.svc.finalize('inv-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.prisma.courierSettlementInvoice.updateMany).not.toHaveBeenCalled();
    expect(ctx.accounting.postFinalization).not.toHaveBeenCalled();
  });

  it('blocks on an unacknowledged YELLOW when warning ack is required', async () => {
    const ctx = await makeService({
      requireAck: true,
      exceptions: [{ ruleId: 'PREVIOUS_SETTLEMENT_EXISTS', severity: 'yellow', status: 'open' }],
    });
    await expect(ctx.svc.finalize('inv-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.prisma.courierSettlementInvoice.updateMany).not.toHaveBeenCalled();
  });

  it('lets an acknowledged YELLOW through when warning ack is required', async () => {
    const ctx = await makeService({
      requireAck: true,
      exceptions: [{ ruleId: 'PREVIOUS_SETTLEMENT_EXISTS', severity: 'yellow', status: 'acknowledged' }],
    });
    const res = await ctx.svc.finalize('inv-1');
    expect(res.state).toBe('ACCOUNTING_POSTED');
  });

  it('lets an unacknowledged YELLOW through when warning ack is NOT required', async () => {
    const ctx = await makeService({
      requireAck: false,
      exceptions: [{ ruleId: 'ZERO_COST_REVIEW', severity: 'yellow', status: 'open' }],
    });
    const res = await ctx.svc.finalize('inv-1');
    expect(res.state).toBe('ACCOUNTING_POSTED');
  });

  it('writes the snapshot inside the same transaction as the state change (§14.2)', async () => {
    const ctx = await makeService();
    const res = await ctx.svc.finalize('inv-1', 'u1');
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ctx.created).toHaveLength(1);
    expect(ctx.created[0]).toEqual(
      expect.objectContaining({ invoiceId: 'inv-1', version: 1, totals: expect.any(Object) }),
    );
    expect(ctx.created[0].rows).toHaveLength(1);
    expect(res.totals).toEqual(
      expect.objectContaining({ collected: 1000, charges: 100, net: 900 }),
    );
  });

  it('returns the balanced figure set and a clean posting for a normal full delivery', async () => {
    const ctx = await makeService();
    const res = await ctx.svc.finalize('inv-1', 'u1');
    expect(res).toEqual(
      expect.objectContaining({
        invoiceId: 'inv-1',
        state: 'ACCOUNTING_POSTED',
        accountingStatus: 'POSTED',
        journalEntryId: 'je-1',
        warnings: [],
      }),
    );
    expect(res.totals.residual).toBe(0);
    expect(ctx.cost.writeBackMany).toHaveBeenCalledWith(['ord-1'], expect.anything(), 'u1');
    expect(ctx.activity.record).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'inv-1', action: 'SNAPSHOT_TAKEN' }),
    );
    expect(ctx.activity.record).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'inv-1', action: 'FINALIZED' }),
    );
    expect(ctx.activity.record).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'inv-1', action: 'POSTED_ACCOUNTING' }),
    );
  });

  it('loses the CAS claim instead of finalizing twice (exactly-once)', async () => {
    const ctx = await makeService({ claimCount: 0 });
    await expect(ctx.svc.finalize('inv-1')).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    expect(ctx.accounting.postFinalization).not.toHaveBeenCalled();
  });

  it('refuses an invoice that is not in a claimable state', async () => {
    const ctx = await makeService({ state: 'ISSUE_FOUND' });
    await expect(ctx.svc.finalize('inv-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses an invoice that is already being finalized', async () => {
    const ctx = await makeService({ state: 'FINALIZING' });
    await expect(ctx.svc.finalize('inv-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('raises NotFound for an unknown invoice', async () => {
    const ctx = await makeService({ state: null });
    await expect(ctx.svc.finalize('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('releases the claim and rethrows when the transaction fails (no silent skip)', async () => {
    const ctx = await makeService({ txFails: true });
    await expect(ctx.svc.finalize('inv-1')).rejects.toThrow('write conflict in transaction');
    expect(ctx.prisma.courierSettlementInvoice.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'inv-1', finalizingToken: expect.any(String) }),
        data: expect.objectContaining({ state: 'READY_FOR_REVIEW', finalizingToken: null }),
      }),
    );
    expect(ctx.accounting.postFinalization).not.toHaveBeenCalled();
    expect(ctx.activity.record).not.toHaveBeenCalled();
  });

  it('reports an accounting failure as ACCOUNTING_FAILED with a repair hint', async () => {
    const ctx = await makeService({ postFails: true });
    const res = await ctx.svc.finalize('inv-1', 'u1');
    expect(res.state).toBe('ACCOUNTING_FAILED');
    expect(res.accountingStatus).toBe('FAILED');
    expect(res.journalEntryId).toBeNull();
    expect(res.warnings.join(' ')).toMatch(/Accounting posting failed:.*Repair/);
    expect(ctx.accounting.markFailure).toHaveBeenCalledWith(
      'inv-1',
      'journal sequence unavailable',
      'u1',
    );
    expect(ctx.prisma.courierSettlementInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { state: 'ACCOUNTING_FAILED' } }),
    );
    expect(ctx.activity.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'POSTED_ACCOUNTING' }),
    );
  });

  it('discloses the disabled-accounting path instead of skipping silently', async () => {
    const ctx = await makeService({ accountingEnabled: false });
    const res = await ctx.svc.finalize('inv-1', 'u1');
    expect(res.state).toBe('ACCOUNTING_SKIPPED_ACCOUNTING_DISABLED');
    expect(res.accountingStatus).toBe('SKIPPED_ACCOUNTING_DISABLED');
    expect(res.warnings).toEqual([
      'Accounting is disabled; the invoice is finalized but no journal was posted.',
    ]);
    expect(ctx.accounting.postFinalization).not.toHaveBeenCalled();
    expect(ctx.getSnapshotCount()).toBe(1);
  });
});

describe('CourierSettlementFinalizeService.reclaimStale (§6)', () => {
  it('reclaims a stale FINALIZING invoice and audits it', async () => {
    const ctx = await makeService({ state: 'FINALIZING' });
    ctx.prisma.courierSettlementInvoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      displayId: 'CS-260927-0001',
      state: 'FINALIZING',
      finalizingStartedAt: new Date(Date.now() - FINALIZING_STALE_MS - 1000),
    });
    await expect(ctx.svc.reclaimStale('inv-1', 'u1')).resolves.toBe(true);
    expect(ctx.prisma.courierSettlementInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'READY_FOR_REVIEW', finalizingToken: null }),
      }),
    );
    expect(ctx.activity.record).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: 'inv-1',
        action: 'EFFECTIVE_STATE_CHANGED',
        detail: { reclaimedStaleFinalizing: true },
      }),
    );
  });

  it('never reclaims a fresh in-flight finalization', async () => {
    const ctx = await makeService({ state: 'FINALIZING' });
    ctx.prisma.courierSettlementInvoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      state: 'FINALIZING',
      finalizingStartedAt: new Date(),
    });
    await expect(ctx.svc.reclaimStale('inv-1')).resolves.toBe(false);
    expect(ctx.prisma.courierSettlementInvoice.update).not.toHaveBeenCalled();
  });

  it('ignores invoices that are not FINALIZING', async () => {
    const ctx = await makeService({ state: 'READY_FOR_REVIEW' });
    await expect(ctx.svc.reclaimStale('inv-1')).resolves.toBe(false);
  });
});
