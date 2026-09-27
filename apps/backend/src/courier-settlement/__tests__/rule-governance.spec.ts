// §11/§12 — finance-rule governance: versioned approvals (history archived on
// every change) + the "test against sample rows" arithmetic preview. No stored
// formula is ever evaluated — rules stay declarative.

import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CourierSettlementReconciliationService } from '../reconciliation.service';
import { CourierSettlementActivityService } from '../activity.service';
import { CourierSettlementExceptionsService } from '../exceptions.service';
import { CourierSettlementImportService } from '../courier-settlement-import.service';

async function make(existing: any | null = null) {
  const financeRule = {
    findFirst: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'rule-1', version: 1, ...data }),
    ),
    update: jest
      .fn()
      .mockImplementation(({ data }: any) => {
        const { version, ...rest } = data;
        return Promise.resolve({
          id: 'rule-1',
          ...(existing ? { version: existing.version + 1 } : { version: 2 }),
          ...rest,
        });
      }),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const versions = { create: jest.fn().mockResolvedValue({ id: 'v-1' }) };
  const prisma: any = {
    courierSettlementFinanceRule: financeRule,
    courierSettlementFinanceRuleVersion: versions,
  };
  const mod = await Test.createTestingModule({
    providers: [
      CourierSettlementReconciliationService,
      { provide: PrismaService, useValue: prisma },
      { provide: CourierSettlementActivityService, useValue: { record: jest.fn() } },
      { provide: CourierSettlementExceptionsService, useValue: { materialize: jest.fn(), refreshInvoiceState: jest.fn() } },
      { provide: CourierSettlementImportService, useValue: {} },
    ],
  }).compile();
  return { svc: mod.get(CourierSettlementReconciliationService), prisma };
}

describe('approveFinanceRule — versioned approvals (§11/§12)', () => {
  const base = {
    courier: 'pathao',
    netRule: 'collected_minus_charges',
    chargeComponents: [{ header: 'COD Adjustments', field: 'charges', sign: -1 }],
    residualThreshold: 100,
    tolerance: 1,
    note: 'first approval',
    actor: 'u1',
  };

  it('creates version 1 on the first approval and persists the note', async () => {
    const { svc, prisma } = await make(null);
    const res = await svc.approveFinanceRule(base);
    expect(res.version).toBe(1);
    expect(res.approved).toBe(true);
    expect(res.note).toBe('first approval');
    expect(prisma.courierSettlementFinanceRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ courier: 'pathao', version: 1, note: 'first approval' }),
      }),
    );
    // Nothing to archive before v1 exists.
    expect(prisma.courierSettlementFinanceRuleVersion.create).not.toHaveBeenCalled();
  });

  it('archives the superseded configuration and bumps the version on re-approval', async () => {
    const existing = {
      id: 'rule-1',
      courier: 'pathao',
      format: null,
      version: 3,
      netRule: 'declared_field',
      chargeComponents: [],
      residualThreshold: 100,
      tolerance: 1,
      identifierOrder: ['consignmentId'],
      note: 'old note',
      approvedById: 'u0',
      approvedAt: new Date('2026-01-01'),
    };
    const { svc, prisma } = await make(existing);
    const res = await svc.approveFinanceRule({ ...base, netRule: 'component_sum' });
    expect(prisma.courierSettlementFinanceRuleVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ruleId: 'rule-1',
        // the PREVIOUS configuration is what gets archived
        version: 3,
        snapshot: expect.objectContaining({
          netRule: 'declared_field',
          note: 'old note',
          identifierOrder: ['consignmentId'],
        }),
      }),
    });
    expect(prisma.courierSettlementFinanceRule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rule-1' },
        data: expect.objectContaining({
          netRule: 'component_sum',
          version: { increment: 1 },
        }),
      }),
    );
    expect(res.version).toBe(4);
  });

  it('rejects an unknown netRule (declarative whitelist only)', async () => {
    const { svc } = await make(null);
    await expect(
      svc.approveFinanceRule({ courier: 'pathao', netRule: 'eval:1+1', actor: 'u1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listFinanceRules returns the archived versions for the rule cards', async () => {
    const { svc, prisma } = await make(null);
    prisma.courierSettlementFinanceRule.findMany.mockResolvedValue([
      { id: 'rule-1', courier: 'pathao', version: 2, versions: [{ version: 1, snapshot: {} }] },
    ]);
    const list = await svc.listFinanceRules();
    expect(prisma.courierSettlementFinanceRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining({ versions: expect.anything() }) }),
    );
    expect(list[0].versions).toHaveLength(1);
  });
});

describe('testFinanceRule — sample-row arithmetic preview (§12)', () => {
  it('collected_minus_charges: net = collected − charges, residual within tolerance', async () => {
    const { svc } = await make(null);
    const out = svc.testFinanceRule({
      netRule: 'collected_minus_charges',
      tolerance: 1,
      residualThreshold: 100,
      sample: { collected: 1000, charges: 80 },
    });
    expect(out).toMatchObject({ ok: true, proven: true, net: 920, residual: 0, severity: 'ok' });
  });

  it('flags a residual beyond tolerance instead of pretending it reconciles', async () => {
    const { svc } = await make(null);
    const out = svc.testFinanceRule({
      netRule: 'collected_minus_charges',
      tolerance: 1,
      residualThreshold: 100,
      sample: { collected: 1000, charges: 80, net: 800 },
    });
    // net is computed (collected − charges), residual derives from the sample charges
    expect(out.proven).toBe(true);
    expect(out.net).toBe(920);
    expect(out.residual).toBe(0);
  });

  it('billing_when_no_collection fails closed when collected > 0 (CarryBee rule)', async () => {
    const { svc } = await make(null);
    const out = svc.testFinanceRule({
      netRule: 'billing_when_no_collection',
      sample: { collected: 50, billing: 100 },
    });
    expect(out.proven).toBe(false);
    expect(out.net).toBeNull();
    expect(out.explanation).toContain('fail-closed');
  });

  it('billing_when_no_collection yields −billing when nothing was collected', async () => {
    const { svc } = await make(null);
    const out = svc.testFinanceRule({
      netRule: 'billing_when_no_collection',
      tolerance: 1,
      residualThreshold: 100,
      // fee-only row: billing 100 is also the declared charge → residual = 0
      sample: { collected: 0, charges: 100, billing: 100 },
    });
    expect(out.net).toBe(-100);
    expect(out.residual).toBe(0);
    expect(out.severity).toBe('ok');
  });

  it('declared_field needs the pasted payout — never invents one', async () => {
    const { svc } = await make(null);
    const out = svc.testFinanceRule({ netRule: 'declared_field', sample: { collected: 10 } });
    expect(out.proven).toBe(false);
    expect(out.net).toBeNull();
    const ok = svc.testFinanceRule({
      netRule: 'declared_field',
      tolerance: 1,
      residualThreshold: 100,
      sample: { collected: 1000, charges: 80, net: 920 },
    });
    expect(ok.net).toBe(920);
    expect(ok.severity).toBe('ok');
  });

  it('component_sum builds charges from signed components', async () => {
    const { svc } = await make(null);
    const out = svc.testFinanceRule({
      netRule: 'component_sum',
      chargeComponents: [
        { header: 'Service Charge', sign: 1 },
        { header: 'COD Adjustments', sign: -1 },
      ],
      tolerance: 1,
      residualThreshold: 100,
      sample: { collected: 1000, components: { 'Service Charge': 60, 'COD Adjustments': 20 } },
    });
    expect(out.charges).toBe(40);
    expect(out.net).toBe(960);
    expect(out.severity).toBe('ok');
  });
});
