import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SetSalaryStructureDto } from './dto/set-salary-structure.dto';

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

  async setSalaryStructure(dto: SetSalaryStructureDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee)
      throw new NotFoundException(
        `Employee with ID ${dto.employeeId} not found`,
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

    await this.prisma.salaryStructure.updateMany({
      where: { employeeId: dto.employeeId, isActive: true },
      data: { isActive: false },
    });

    return this.prisma.salaryStructure.create({
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
      },
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
      where: { employeeId, isActive: true },
    });
    if (!salaryStructure)
      throw new BadRequestException(
        `No active salary structure for employee ${employeeId}`,
      );

    const existing = await this.prisma.payslip.findFirst({
      where: { employeeId, periodStart, periodEnd },
    });
    if (existing)
      throw new BadRequestException(
        `Payslip already exists for employee ${employeeId} in this period`,
      );

    const items = [
      {
        type: 'earnings',
        label: 'Basic Salary',
        amount: salaryStructure.basicSalary,
      },
      {
        type: 'earnings',
        label: 'House Allowance',
        amount: salaryStructure.houseAllowance,
      },
      {
        type: 'earnings',
        label: 'Medical Allowance',
        amount: salaryStructure.medicalAllowance,
      },
      {
        type: 'earnings',
        label: 'Transport Allowance',
        amount: salaryStructure.transportAllowance,
      },
      {
        type: 'earnings',
        label: 'Other Allowance',
        amount: salaryStructure.otherAllowance,
      },
      {
        type: 'deductions',
        label: 'Tax',
        amount: salaryStructure.taxDeduction,
      },
      {
        type: 'deductions',
        label: 'Insurance',
        amount: salaryStructure.insuranceDeduction,
      },
      {
        type: 'deductions',
        label: 'Other Deduction',
        amount: salaryStructure.otherDeduction,
      },
    ];

    return this.prisma.$transaction(async (tx) => {
      const payslip = await tx.payslip.create({
        data: {
          employeeId,
          periodStart,
          periodEnd,
          totalEarnings: salaryStructure.totalEarnings,
          totalDeductions: salaryStructure.totalDeductions,
          netPay: salaryStructure.netSalary,
          status: 'draft',
        },
      });

      await tx.payslipItem.createMany({
        data: items.map((item) => ({ ...item, payslipId: payslip.id })),
      });

      return tx.payslip.findUnique({
        where: { id: payslip.id },
        include: { items: true, employee: true },
      });
    });
  }

  async findAllPayslips(page = 1, perPage = 20) {
    page = Math.max(1, page);
    perPage = Math.max(1, Math.min(100, perPage));
    const [data, total] = await Promise.all([
      this.prisma.payslip.findMany({
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
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
      this.prisma.payslip.count(),
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
}
