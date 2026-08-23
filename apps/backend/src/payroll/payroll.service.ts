import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SetSalaryStructureDto } from './dto/set-salary-structure.dto';
import { LedgerStatus, PayslipStatus } from '@prisma/client';

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

  // Decision #2 (§5.1): periodKey is the per-employee payroll-period identity
  // (YYYY-MM) used for the unique constraint + duplicate detection.
  private computePeriodKey(periodStart: Date): string {
    const y = periodStart.getUTCFullYear();
    const mm = String(periodStart.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${mm}`;
  }

  async setSalaryStructure(dto: SetSalaryStructureDto) {
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

    const [approvedEarnings, approvedDeductions] = await Promise.all([
      this.prisma.employeeEarning.findMany({ where: ledgerWhere }),
      this.prisma.employeeDeduction.findMany({ where: ledgerWhere }),
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

    const grossEarnings =
      proratedEarnings.reduce((s, e) => s + e.amount, 0) +
      ledgerEarningItems.reduce((s, e) => s + e.amount, 0);
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
    const [data, total] = await Promise.all([
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
    ]);

    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
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

    return this.prisma.payslip.update({
      where: { id },
      data: { status: 'paid', paidAt: new Date() },
      include: { items: true, employee: true },
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

  async setStatus(id: string, status: 'reviewed' | 'approved' | 'cancelled') {
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

    const data: { status: PayslipStatus; reviewedAt?: Date; approvedAt?: Date } =
      { status };
    if (status === 'reviewed') data.reviewedAt = new Date();
    if (status === 'approved') data.approvedAt = new Date();

    return this.prisma.payslip.update({
      where: { id },
      data,
      include: { items: true, employee: true },
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
