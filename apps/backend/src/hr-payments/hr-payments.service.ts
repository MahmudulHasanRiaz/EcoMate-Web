import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Injectable()
export class HrPaymentsService {
  constructor(private prisma: PrismaService) {}

  async createPayment(dto: CreatePaymentDto, actorId?: string) {
    const payslip = await this.prisma.payslip.findUnique({
      where: { id: dto.payslipId },
    });
    if (!payslip)
      throw new NotFoundException(
        `Payslip with ID ${dto.payslipId} not found`,
      );

    // Decision #2 (§5.1): payments only flow against an approved snapshot.
    if (['draft', 'reviewed', 'cancelled'].includes(payslip.status))
      throw new BadRequestException(
        'Payslip must be approved before payment',
      );

    const netPay = Number(payslip.netPay);

    const agg = await this.prisma.payrollPayment.aggregate({
      where: { payslipId: dto.payslipId },
      _sum: { amount: true },
    });
    const paidSoFar = Number(agg._sum.amount ?? 0);

    if (paidSoFar + dto.amount > netPay)
      throw new BadRequestException('Payment exceeds net pay');

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payrollPayment.create({
        data: {
          payslipId: dto.payslipId,
          amount: dto.amount,
          method: dto.method ?? null,
          referenceNo: dto.referenceNo ?? null,
          note: dto.note ?? null,
          recordedById: actorId ?? null,
        },
      });

      const totalPaid = paidSoFar + dto.amount;
      const newStatus = totalPaid >= netPay ? 'paid' : 'partially_paid';

      const updatedPayslip = await tx.payslip.update({
        where: { id: dto.payslipId },
        data:
          newStatus === 'paid'
            ? { status: 'paid', paidAt: new Date() }
            : { status: 'partially_paid' },
      });

      return { payment, payslip: updatedPayslip };
    });
  }

  async findPayments(payslipId: string) {
    const payslip = await this.prisma.payslip.findUnique({
      where: { id: payslipId },
    });
    if (!payslip)
      throw new NotFoundException(`Payslip with ID ${payslipId} not found`);
    return this.prisma.payrollPayment.findMany({
      where: { payslipId },
      orderBy: { paidAt: 'desc' },
    });
  }

  async deletePayment(payslipId: string, paymentId: string, actorId?: string) {
    const payslip = await this.prisma.payslip.findUnique({
      where: { id: payslipId },
    });
    if (!payslip)
      throw new NotFoundException(`Payslip with ID ${payslipId} not found`);

    // Decision #2 (§5.2): payments may be removed only while the payslip is
    // still pre-final (draft/reviewed); once approved/paid it is a locked
    // accounting record — corrections go on a later period. We also allow it
    // while partially paid so a mistaken partial can be reversed before full
    // payment lands.
    if (!['draft', 'reviewed', 'partially_paid'].includes(payslip.status))
      throw new BadRequestException(
        'Payments can only be removed before the payslip is fully paid',
      );

    const payment = await this.prisma.payrollPayment.findUnique({
      where: { id: paymentId },
    });
    if (!payment)
      throw new NotFoundException(`Payment with ID ${paymentId} not found`);

    return this.prisma.$transaction(async (tx) => {
      await tx.payrollPayment.delete({ where: { id: paymentId } });

      const agg = await tx.payrollPayment.aggregate({
        where: { payslipId },
        _sum: { amount: true },
      });
      const remaining = Number(agg._sum.amount ?? 0);
      const newStatus =
        remaining >= Number(payslip.netPay) ? 'paid' : 'partially_paid';

      const updatedPayslip = await tx.payslip.update({
        where: { id: payslipId },
        data: newStatus === 'paid' ? { status: 'paid' } : { status: 'partially_paid' },
      });

      return { payment, payslip: updatedPayslip };
    });
  }
}
