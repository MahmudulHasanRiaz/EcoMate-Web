import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentInput } from './dto/create-payment.dto';
import { PayslipStatus } from '@prisma/client';
import {
  requireConfiguredGateway,
  resolvePaymentAccountId,
} from '../payments/payment-account';
import { PaymentJournalService } from '../accounting/payment-journal.service';

@Injectable()
export class HrPaymentsService {
  constructor(
    private prisma: PrismaService,
    // Phase 2 — auto-journal for recorded salary payments. Optional so the
    // existing unit tests that build the service without it keep working.
    @Optional() private readonly paymentJournal?: PaymentJournalService,
  ) {}

  async createPayment(dto: CreatePaymentInput, actorId?: string) {
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

    // G-20: only LIVE (non-voided) payments count toward the paid total.
    const agg = await this.prisma.payrollPayment.aggregate({
      where: { payslipId: dto.payslipId, voidedAt: null },
      _sum: { amount: true },
    });
    const paidSoFar = Number(agg._sum.amount ?? 0);

    if (paidSoFar + dto.amount > netPay)
      throw new BadRequestException('Payment exceeds net pay');

    // Part 5: salaries go out over configured rails + an eligible asset leaf.
    // `method` is the gateway code on the new write path; legacy values stay
    // readable but are never accepted as typed destinations again.
    const gateway = dto.method
      ? await requireConfiguredGateway(this.prisma, dto.method)
      : null;
    const accountId = await resolvePaymentAccountId(this.prisma, {
      accountId: dto.accountId,
      gatewayAccountId: gateway?.accountId,
    });

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payrollPayment.create({
        data: {
          payslipId: dto.payslipId,
          amount: dto.amount,
          method: dto.method ?? null,
          accountId,
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
    }).then(async (result) => {
      // Phase 2: record the salary cost in the books — Dr salary/compensation
      // expense / Cr the mapped asset leaf the money left from. Posted AFTER
      // the payment commits, exactly one entry per payment (idempotent), and
      // never fatal to the payment itself.
      await this.paymentJournal?.tryPostPayrollPayment(result.payment.id);
      return result;
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

  // G-20 / Decision D3: replaces hard DELETE with an auditable void. Original
  // payment row immutable; voidedAt/voidedById/voidReason recorded. The payslip
  // status is recomputed from the live (non-voided) payment sum, so voiding a
  // full payment downgrades paid → partially_paid (or → approved at zero).
  async voidPayment(
    payslipId: string,
    paymentId: string,
    reason: string,
    actorId?: string,
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException('reason is required to void a payment');
    }

    const payslip = await this.prisma.payslip.findUnique({
      where: { id: payslipId },
    });
    if (!payslip)
      throw new NotFoundException(`Payslip with ID ${payslipId} not found`);

    const payment = await this.prisma.payrollPayment.findUnique({
      where: { id: paymentId },
    });
    if (!payment || payment.payslipId !== payslipId)
      throw new NotFoundException(`Payment with ID ${paymentId} not found`);

    if (payment.voidedAt)
      throw new BadRequestException('Payment is already voided');

    return this.prisma.$transaction(async (tx) => {
      const voided = await tx.payrollPayment.update({
        where: { id: paymentId },
        data: {
          voidedAt: new Date(),
          voidedById: actorId ?? null,
          voidReason: reason.trim(),
        },
      });

      const agg = await tx.payrollPayment.aggregate({
        where: { payslipId, voidedAt: null },
        _sum: { amount: true },
      });
      const totalValid = Number(agg._sum.amount ?? 0);
      const netPay = Number(payslip.netPay);

      let data: { status: PayslipStatus; paidAt: Date | null };
      if (totalValid >= netPay) {
        data = { status: 'paid', paidAt: new Date() };
      } else if (totalValid > 0) {
        data = { status: 'partially_paid', paidAt: null };
      } else {
        data = { status: 'approved', paidAt: null };
      }

      const updatedPayslip = await tx.payslip.update({
        where: { id: payslipId },
        data,
      });

      return { payment: voided, payslip: updatedPayslip };
    }).then(async (result) => {
      // Phase 2: voiding is a REVERSAL, never a delete — a compensating entry
      // on the original journal's own accounts, keyed by the payment identity.
      await this.paymentJournal?.tryReversePayrollPayment(
        result.payment.id,
        `payroll payment voided: ${reason.trim()}`,
      );
      return result;
    });
  }
}
