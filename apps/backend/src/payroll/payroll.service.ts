import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompensationExpenseService } from '../expenses/compensation-expense.service';
import { SetSalaryStructureDto } from './dto/set-salary-structure.dto';
import { LedgerStatus, PayslipStatus } from '@prisma/client';

@Injectable()
export class PayrollService {
  constructor(
    private prisma: PrismaService,
    private readonly compensation: CompensationExpenseService,
  ) {}

  /**
   * Salary cost excludes commission lines: commissions post their own expense
   * at accrual (v1 + v2), so including them here would double-count.
   */
  private salaryExpenseAmount(payslip: {
    totalEarnings: unknown;
    items?: { type: string; label: string; amount: unknown }[];
  }): number {
    const commission = (payslip.items ?? [])
      .filter((i) => i.type === 'earnings' && i.label === 'Commission')
      .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    const net = (Number(payslip.totalEarnings) || 0) - commission;
    return Math.round(net * 100) / 100;
  }

  private salaryExpenseDescription(payslip: {
    periodKey?: string | null;
    id: string;
  }): string {
    return `Salary — ${payslip.periodKey ?? payslip.id}`;
  }

  // Decision #2 (§5.1): periodKey is the per-employee payroll-period identity
  // (YYYY-MM) used for the unique constraint + duplicate detection.
  private computePeriodKey(periodStart: Date): string {
    const y = periodStart.getUTCFullYear();
    const mm = String(periodStart.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${mm}`;
  }

  async setSalaryStructure(dto: SetSalaryStructureDto, actorId?: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee)
      throw new NotFoundException(
        `Employee with ID ${dto.employeeId} not found`,
      );

    if (!dto.effectiveFrom)
      throw new BadRequestException('effectiveFrom is required');

    const effectiveFrom = new Date(dto.effectiveFrom);
    const effDay = new Date(effectiveFrom);
    effDay.setHours(0, 0, 0, 0);
    const joinedDay = new Date(employee.joiningDate);
    joinedDay.setHours(0, 0, 0, 0);
    if (effDay < joinedDay)
      throw new BadRequestException(
        'effectiveFrom cannot be before the employee joining date',
      );

    const basicSalary = dto.basicSalary;
    const houseAllowance = dto.houseAllowance || 0;
    const medicalAllowance = dto.medicalAllowance || 0;
    const transportAllowance = dto.transportAllowance || 0;
    const otherAllowance = dto.otherAllowance || 0;
    const taxDeduction = dto.taxDeduction || 0;
    const insuranceDeduction = dto.insuranceDeduction || 0;
    const otherDeduction = dto.otherDeduction || 0;

    const totalEarnings =
      basicSalary +
      houseAllowance +
      medicalAllowance +
      transportAllowance +
      otherAllowance;
    const totalDeductions = taxDeduction + insuranceDeduction + otherDeduction;
    const netSalary = totalEarnings - totalDeductions;

    // Close the active window the day before the new structure starts so
    // the two windows never overlap and never leave a gap.
    const effectiveTo = new Date(
      effectiveFrom.getTime() - 24 * 60 * 60 * 1000,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.salaryStructure.updateMany({
        where: { employeeId: dto.employeeId, isActive: true },
        data: { isActive: false, effectiveTo },
      });

      const structure = await tx.salaryStructure.create({
        data: {
          employeeId: dto.employeeId,
          basicSalary,
          houseAllowance,
          medicalAllowance,
          transportAllowance,
          otherAllowance,
          taxDeduction,
          insuranceDeduction,
          otherDeduction,
          totalEarnings,
          totalDeductions,
          netSalary,
          effectiveFrom,
          effectiveTo: null,
          isActive: true,
          createdById: actorId ?? null,
        },
      });

      // Decision #7: Employee.salary is a read-only mirror of the active
      // SalaryStructure net — the structure is the single source of truth.
      await tx.employee.update({
        where: { id: dto.employeeId },
        data: { salary: netSalary },
      });

      return structure;
    });
  }

  async getSalaryStructure(employeeId: string) {
    const structure = await this.prisma.salaryStructure.findFirst({
      where: { employeeId, isActive: true },
    });
    if (!structure)
      throw new NotFoundException(
        `No active salary structure for employee ${employeeId}`,
      );
    return structure;
  }

  async generatePayslip(
    employeeId: string,
    periodStart: Date,
    periodEnd: Date,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee)
      throw new NotFoundException(`Employee with ID ${employeeId} not found`);

    const salaryStructure = await this.prisma.salaryStructure.findFirst({
      where: {
        employeeId,
        isActive: true,
        effectiveFrom: { lte: periodStart },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: periodEnd } },
        ],
      },
    });
    if (!salaryStructure)
      throw new BadRequestException(
        'No active salary structure for this period',
      );

    // Decision #2 (§5.1): one payslip per employee per period. Use the
    // canonical periodKey for the duplicate check (replaces the old
    // periodStart+periodEnd match).
    const periodKey = this.computePeriodKey(periodStart);
    const existing = await this.prisma.payslip.findFirst({
      where: { employeeId, periodKey },
    });
    if (existing)
      throw new ConflictException(
        'Payslip already exists for this period',
      );

    // Decision #2 (§5.4): pro-rate the EARNINGS total by the employee's
    // tenure within the period (joining mid-period → reduced earnings).
    // Statutory deductions from the structure stay full.
    const spanMs = periodEnd.getTime() - periodStart.getTime();
    const effectiveStartMs = Math.max(
      employee.joiningDate.getTime(),
      periodStart.getTime(),
    );
    const ratio =
      spanMs <= 0
        ? 1
        : Math.min(
            1,
            Math.max(0, (periodEnd.getTime() - effectiveStartMs) / spanMs),
          );

    const structureEarnings = [
      { label: 'Basic Salary', amount: Number(salaryStructure.basicSalary) },
      {
        label: 'House Allowance',
        amount: Number(salaryStructure.houseAllowance),
      },
      {
        label: 'Medical Allowance',
        amount: Number(salaryStructure.medicalAllowance),
      },
      {
        label: 'Transport Allowance',
        amount: Number(salaryStructure.transportAllowance),
      },
      {
        label: 'Other Allowance',
        amount: Number(salaryStructure.otherAllowance),
      },
    ];
    const structureDeductions = [
      { label: 'Tax', amount: Number(salaryStructure.taxDeduction) },
      {
        label: 'Insurance',
        amount: Number(salaryStructure.insuranceDeduction),
      },
      {
        label: 'Other Deduction',
        amount: Number(salaryStructure.otherDeduction),
      },
    ];

    const proratedEarnings = structureEarnings.map((e) => ({
      type: 'earnings' as const,
      label: e.label,
      amount: Math.round(e.amount * ratio * 100) / 100,
    }));

    // Approved ledger earnings/deductions applicable to this period.
    const ledgerWhere = {
      employeeId,
      status: LedgerStatus.approved,
      AND: [
        {
          OR: [
            { applicableFrom: null },
            { applicableFrom: { lte: periodEnd } },
          ],
        },
        {
          OR: [
            { applicableTo: null },
            { applicableTo: { gte: periodStart } },
          ],
        },
      ],
    };

    const [approvedEarnings, approvedDeductions, commissionEarnings, ledgerV2Earnings] =
      await Promise.all([
        this.prisma.employeeEarning.findMany({ where: ledgerWhere }),
        this.prisma.employeeDeduction.findMany({ where: ledgerWhere }),
        // Decision #2 (§G-02): only approved, NOT-yet-payslipped, NOT-reversed
        // commission earnings feed the payslip as distinct 'Commission' items.
        // payslipId is set inside the create tx (snapshot lock) so earnings
        // already claimed by an earlier payslip are never double-included.
        //
        // NOTE the v1 limitation this carries: `reversals: { none: {} }` drops a
        // PARTIALLY reversed earning entirely rather than paying the net, so a
        // 25% reversal on a ৳100 earning removed all ৳100. v2 (below) nets
        // properly; this legacy path is left as-is so existing payslip behaviour
        // does not change retroactively.
        this.prisma.commissionEarning.findMany({
          where: {
            employeeId,
            status: LedgerStatus.approved,
            payslipId: null,
            createdAt: { gte: periodStart, lte: periodEnd },
            reversals: { none: {} },
          },
          select: { id: true, amount: true },
        }),
        // Commission Engine v2. Net of reversals: an earning that was 25%
        // reversed contributes 75%, not 0%. Fully reversed rows contribute
        // nothing and are filtered out here.
        this.prisma.commissionLedgerV2.findMany({
          where: {
            employeeId,
            status: LedgerStatus.approved,
            payslipId: null,
            qualifiedAt: { gte: periodStart, lte: periodEnd },
          },
          select: {
            id: true,
            amount: true,
            reversals: { select: { amount: true } },
          },
        }),
      ]);

    const ledgerEarningItems = approvedEarnings.map((e) => ({
      type: 'earnings' as const,
      label: e.reason || e.type,
      amount: Number(e.amount),
    }));
    const ledgerDeductionItems = approvedDeductions.map((d) => ({
      type: 'deductions' as const,
      label: d.reason || d.type,
      amount: Number(d.amount),
    }));
    const commissionItems = commissionEarnings.map((c) => ({
      type: 'earnings' as const,
      label: 'Commission',
      amount: Number(c.amount),
    }));

    // v2 contributes the NET of each earning and its reversals, so a partial
    // reversal reduces the payslip by the reversed share instead of removing
    // the whole amount.
    const ledgerV2Items = ledgerV2Earnings
      .map((row) => {
        const gross = Number(row.amount);
        const reversed = row.reversals.reduce((sum, r) => sum + Number(r.amount), 0);
        return { net: Math.round((gross - reversed) * 100) / 100 };
      })
      .filter((r) => r.net > 0)
      .map((r) => ({
        type: 'earnings' as const,
        label: 'Commission',
        amount: r.net,
      }));

    const grossEarnings =
      proratedEarnings.reduce((s, e) => s + e.amount, 0) +
      ledgerEarningItems.reduce((s, e) => s + e.amount, 0) +
      commissionItems.reduce((s, e) => s + e.amount, 0) +
      ledgerV2Items.reduce((s, e) => s + e.amount, 0);
    const totalDeductions =
      structureDeductions.reduce((s, d) => s + d.amount, 0) +
      ledgerDeductionItems.reduce((s, d) => s + d.amount, 0);
    const netPay = Math.round((grossEarnings - totalDeductions) * 100) / 100;

    const items = [
      ...proratedEarnings,
      ...structureDeductions.map((d) => ({
        type: 'deductions' as const,
        label: d.label,
        amount: d.amount,
      })),
      ...ledgerEarningItems,
      ...ledgerDeductionItems,
      ...commissionItems,
      ...ledgerV2Items,
    ];

    return this.prisma.$transaction(async (tx) => {
      // Race guard: two concurrent generations for the same (employeeId,
      // periodKey) can both pass the pre-check above; the unique constraint
      // then fires P2002 — surface it as a friendly 409, not a raw Prisma.
      let payslip;
      try {
        payslip = await tx.payslip.create({
          data: {
            employeeId,
            periodStart,
            periodEnd,
            periodKey,
            totalEarnings: grossEarnings,
            totalDeductions: totalDeductions,
            netPay,
            status: 'draft',
          },
        });
      } catch (err) {
        if ((err as { code?: string } | null)?.code === 'P2002') {
          throw new ConflictException(
            'Payslip already exists for this period',
          );
        }
        throw err;
      }

      await tx.payslipItem.createMany({
        data: items.map((item) => ({ ...item, payslipId: payslip.id })),
      });

      // Same snapshot lock for the v2 ledger. Without this a v2 earning would be
      // picked up again by the next payslip and paid twice.
      if (ledgerV2Earnings.length > 0) {
        await tx.commissionLedgerV2.updateMany({
          where: {
            id: { in: ledgerV2Earnings.map((c) => c.id) },
            payslipId: null,
          },
          data: { payslipId: payslip.id },
        });
      }

      // Snapshot lock (Decision #2): claim every commission earning that fed
      // this payslip. Guarded by `payslipId: null` so a concurrent generation
      // can never double-claim a row; only the winner marks it.
      if (commissionEarnings.length > 0) {
        await tx.commissionEarning.updateMany({
          where: {
            id: { in: commissionEarnings.map((c) => c.id) },
            payslipId: null,
          },
          data: { payslipId: payslip.id },
        });
      }

      return tx.payslip.findUnique({
        where: { id: payslip.id },
        include: { items: true, employee: true },
      });
    });
  }

  async findAllPayslips(
    page = 1,
    perPage = 20,
    periodKey?: string,
    employeeId?: string,
  ) {
    page = Math.max(1, page);
    perPage = Math.max(1, Math.min(100, perPage));
    const where: any = {};
    if (periodKey) where.periodKey = periodKey;
    if (employeeId) where.employeeId = employeeId;
    const [data, total, summary] = await Promise.all([
      this.prisma.payslip.findMany({
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              betterAuthUser: { select: { name: true, email: true } },
            },
          },
        },
      }),
      this.prisma.payslip.count({ where }),
      this.buildPayslipSummary(where),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
        summary,
      },
    };
  }

  // Decision #2 / G-23: the list meta carries financial summary for the current
  // filter (periodKey/employee), computed over the FULL filtered set (not the
  // page) so admin totals are filter-accurate. All plain aggregates — cheap.
  private async buildPayslipSummary(where: any) {
    const [empRows, earnAgg, deductAgg, netAgg, commAgg, payAgg] =
      await Promise.all([
        this.prisma.payslip.groupBy({
          by: ['employeeId'],
          where,
        }),
        this.prisma.payslip.aggregate({
          where,
          _sum: { totalEarnings: true },
        }),
        this.prisma.payslip.aggregate({
          where,
          _sum: { totalDeductions: true },
        }),
        this.prisma.payslip.aggregate({ where, _sum: { netPay: true } }),
        // Commission is tracked as a distinct PayslipItem line labelled
        // 'Commission' (see generatePayslip) — sum it across the filtered set.
        this.prisma.payslipItem.aggregate({
          where: { label: 'Commission', payslip: where },
          _sum: { amount: true },
        }),
        // Only live (non-voided) payments count toward paid totals.
        this.prisma.payrollPayment.aggregate({
          where: { voidedAt: null, payslip: where },
          _sum: { amount: true },
        }),
      ]);

    const totalEarnings = Math.round(Number(earnAgg._sum.totalEarnings ?? 0) * 100) / 100;
    const totalDeductions = Math.round(Number(deductAgg._sum.totalDeductions ?? 0) * 100) / 100;
    const netPay = Math.round(Number(netAgg._sum.netPay ?? 0) * 100) / 100;
    const totalCommission = Math.round(Number(commAgg._sum.amount ?? 0) * 100) / 100;
    const totalPaid = Math.round(Number(payAgg._sum.amount ?? 0) * 100) / 100;
    const outstanding = Math.round((netPay - totalPaid) * 100) / 100;

    return {
      employeeCount: empRows.length,
      totalEarnings,
      totalDeductions,
      totalCommission,
      netPay,
      totalPaid,
      outstanding,
    };
  }

  async findPayslip(id: string) {
    const payslip = await this.prisma.payslip.findUnique({
      where: { id },
      include: { items: true, employee: true },
    });
    if (!payslip)
      throw new NotFoundException(`Payslip with ID ${id} not found`);
    return payslip;
  }

  async approvePayslip(id: string) {
    const payslip = await this.prisma.payslip.findUnique({ where: { id } });
    if (!payslip)
      throw new NotFoundException(`Payslip with ID ${id} not found`);

    if (payslip.status !== 'draft')
      throw new BadRequestException(
        `Cannot approve payslip with status "${payslip.status}"`,
      );

    const paidAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payslip.update({
        where: { id },
        data: { status: 'paid', paidAt },
        include: { items: true, employee: true },
      });

      // Payroll finalisation → Operating Expenses, exactly once per payslip.
      const amount = this.salaryExpenseAmount(updated);
      if (amount > 0) {
        await this.compensation.postCompensationExpense(
          {
            sourceType: 'payroll',
            sourceId: payslip.id,
            amount,
            expenseDate: paidAt,
            description: this.salaryExpenseDescription({
              id: payslip.id,
              periodKey: updated.periodKey,
            }),
            categorySlug: 'salaries',
          },
          tx,
        );
      }
      return updated;
    });
  }

  // Decision #2 (§5.1): explicit lifecycle transition endpoint.
  // approved payslips are LOCKED — no further status edits (payments still
  // flow through the hr-payments module). Invalid transitions → 400.
  private static readonly STATUS_TRANSITIONS: Record<
    string,
    PayslipStatus[]
  > = {
    reviewed: ['draft'],
    approved: ['reviewed'],
    cancelled: ['draft', 'reviewed'],
  };

  async setStatus(
    id: string,
    status: 'reviewed' | 'approved' | 'cancelled',
    actorId?: string,
  ) {
    const payslip = await this.prisma.payslip.findUnique({ where: { id } });
    if (!payslip)
      throw new NotFoundException(`Payslip with ID ${id} not found`);

    const allowed = PayrollService.STATUS_TRANSITIONS[status];
    if (!allowed)
      throw new BadRequestException(`Invalid transition to "${status}"`);
    if (!allowed.includes(payslip.status))
      throw new BadRequestException(
        `Invalid transition from "${payslip.status}" to "${status}"`,
      );

    const data: {
      status: PayslipStatus;
      reviewedAt?: Date;
      approvedAt?: Date;
      reviewedById?: string | null;
      approvedById?: string | null;
    } = { status };
    const now = new Date();
    if (status === 'reviewed') {
      data.reviewedAt = now;
      data.reviewedById = actorId ?? null;
    }
    if (status === 'approved') {
      data.approvedAt = now;
      data.approvedById = actorId ?? null;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payslip.update({
        where: { id },
        data,
        include: { items: true, employee: true },
      });

      if (status === 'approved') {
        // Approving a payroll run finalises its salary cost (idempotent by
        // payslip id). Commission lines are excluded — they already posted
        // their own expense at accrual.
        const amount = this.salaryExpenseAmount(updated);
        if (amount > 0) {
          await this.compensation.postCompensationExpense(
            {
              sourceType: 'payroll',
              sourceId: payslip.id,
              amount,
              expenseDate: now,
              description: this.salaryExpenseDescription({
                id: payslip.id,
                periodKey: updated.periodKey,
              }),
              categorySlug: 'salaries',
            },
            tx,
          );
        }
      }

      if (status === 'cancelled') {
        // Defensive: current transitions forbid cancelling a finalised
        // payslip, but if a salary expense was posted it must be reversed
        // rather than silently surviving the cancellation.
        await this.compensation.reverseCompensationExpense(
          {
            sourceType: 'payroll',
            sourceId: payslip.id,
            expenseDate: now,
            description: `Salary reversal — ${payslip.periodKey ?? payslip.id}`,
            categorySlug: 'salaries',
          },
          tx,
        );
      }

      return updated;
    });
  }

  async getPayments(payslipId: string) {
    return this.prisma.payrollPayment.findMany({
      where: { payslipId },
      orderBy: { paidAt: 'desc' },
    });
  }

  async getSalaryStructureHistory(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!employee)
      throw new NotFoundException(`Employee with ID ${employeeId} not found`);

    return this.prisma.salaryStructure.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async getSummary(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee)
      throw new NotFoundException(`Employee with ID ${employeeId} not found`);

    const [currentStructure, structures, recentPayslips, settledPayslips] =
      await Promise.all([
        this.prisma.salaryStructure.findFirst({
          where: { employeeId, isActive: true },
        }),
        this.prisma.salaryStructure.findMany({
          where: { employeeId },
          orderBy: { effectiveFrom: 'desc' },
        }),
        this.prisma.payslip.findMany({
          where: { employeeId },
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: { id: true, periodKey: true, netPay: true, status: true },
        }),
        this.prisma.payslip.findMany({
          where: {
            employeeId,
            status: { in: ['approved', 'partially_paid', 'paid'] },
          },
          select: {
            id: true,
            netPay: true,
            payments: { select: { amount: true } },
          },
        }),
      ]);

    const paidAgg = await this.prisma.payrollPayment.aggregate({
      where: { payslip: { employeeId } },
      _sum: { amount: true },
    });
    const totalPaid = Number(paidAgg._sum.amount ?? 0);

    const outstanding = Math.round(
      settledPayslips.reduce((sum, p) => {
        const paid = p.payments.reduce((s, pay) => s + Number(pay.amount), 0);
        return sum + (Number(p.netPay) - paid);
      }, 0) * 100,
    ) / 100;

    return {
      currentStructure,
      mirrorSalary:
        employee.salary != null ? Number(employee.salary) : null,
      structures,
      payslips: recentPayslips,
      totalPaid: Math.round(totalPaid * 100) / 100,
      outstanding,
    };
  }
}
