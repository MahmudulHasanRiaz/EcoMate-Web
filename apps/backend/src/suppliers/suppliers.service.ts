import {
  Injectable,
  NotFoundException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import {
  requireConfiguredGateway,
  resolvePaymentAccountId,
} from '../payments/payment-account';
import { PaymentJournalService } from '../accounting/payment-journal.service';

@Injectable()
export class SuppliersService {
  constructor(
    private prisma: PrismaService,
    // Phase 2 — auto-journal for recorded supplier payments. Optional so the
    // existing unit tests that build the service without it keep working.
    @Optional() private readonly paymentJournal?: PaymentJournalService,
  ) {}

  async create(createSupplierDto: CreateSupplierDto) {
    const existing = await this.prisma.supplier.findUnique({
      where: { slug: createSupplierDto.slug },
    });

    if (existing) {
      throw new ConflictException('Supplier with this slug already exists');
    }

    return this.prisma.supplier.create({
      data: createSupplierDto,
    });
  }

  async findAll(activeOnly = false, page = 1, perPage = 20) {
    const skip = (page - 1) * perPage;
    const where = activeOnly ? { isActive: true } : {};

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
        include: {
          _count: {
            select: { purchases: true },
          },
        },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        _count: {
          select: { purchases: true },
        },
        payments: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            invoices: true,
          },
        },
      },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID ${id} not found`);
    }

    return supplier;
  }

  async createPayment(supplierId: string, dto: CreatePaymentDto) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID ${supplierId} not found`);
    }

    if (new Prisma.Decimal(dto.amount).gt(supplier.balance)) {
      throw new ConflictException(
        `Payment amount (${dto.amount}) exceeds outstanding balance (${supplier.balance})`,
      );
    }

    // Part 5: money-out destination is configured, never typed. A supplied
    // gateway must exist; the mapped account is stamped unless an eligible
    // account is supplied explicitly.
    const gateway = dto.paymentMethod
      ? await requireConfiguredGateway(this.prisma, dto.paymentMethod)
      : null;
    const accountId = await resolvePaymentAccountId(this.prisma, {
      accountId: dto.accountId,
      gatewayAccountId: gateway?.accountId,
    });

    const now = new Date();
    const dateStr = `${now.getFullYear().toString().slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const todayPrefix = `PINV-${dateStr}-`;

    return this.prisma.$transaction(async (tx) => {
      const lastTodayInvoice = await tx.supplierPaymentInvoice.findFirst({
        where: { invoiceNo: { startsWith: todayPrefix } },
        orderBy: { invoiceNo: 'desc' },
      });

      let nextSeq = 1;
      if (lastTodayInvoice) {
        const parts = lastTodayInvoice.invoiceNo.split('-');
        nextSeq = parseInt(parts[2], 10) + 1;
      }

      const invoiceNo = `${todayPrefix}${String(nextSeq).padStart(4, '0')}`;

      const payment = await tx.supplierPayment.create({
        data: {
          supplierId,
          amount: dto.amount,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          paymentMethod: dto.paymentMethod,
          accountId,
          reference: dto.reference,
          notes: dto.notes,
          invoices: {
            create: { invoiceNo },
          },
        },
        include: { invoices: true },
      });

      await tx.supplier.update({
        where: { id: supplierId },
        data: {
          totalPaid: { increment: dto.amount },
          balance: { decrement: dto.amount },
        },
      });

      return payment;
    }).then(async (payment) => {
      // Phase 2: paying a supplier settles a payable — Dr the supplier payable
      // leaf / Cr the mapped asset leaf the money left from. Posted AFTER the
      // payment commits; idempotent, never fatal to the payment.
      await this.paymentJournal?.tryPostSupplierPayment(payment.id);
      return payment;
    });
  }

  async getPayments(supplierId: string, page: number, perPage: number) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID ${supplierId} not found`);
    }

    const skip = (page - 1) * perPage;

    const [data, total] = await Promise.all([
      this.prisma.supplierPayment.findMany({
        where: { supplierId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
        include: { invoices: true },
      }),
      this.prisma.supplierPayment.count({
        where: { supplierId },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async getPayment(paymentId: string) {
    const payment = await this.prisma.supplierPayment.findUnique({
      where: { id: paymentId },
      include: {
        invoices: true,
        supplier: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${paymentId} not found`);
    }

    return payment;
  }

  async update(id: string, updateSupplierDto: UpdateSupplierDto) {
    await this.findOne(id);

    if (updateSupplierDto.slug) {
      const existing = await this.prisma.supplier.findUnique({
        where: { slug: updateSupplierDto.slug },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Supplier with this slug already exists');
      }
    }

    return this.prisma.supplier.update({
      where: { id },
      data: updateSupplierDto,
    });
  }

  async remove(id: string) {
    const supplier = await this.findOne(id);

    if (supplier._count.purchases > 0) {
      throw new ConflictException(
        `Cannot delete supplier with ${supplier._count.purchases} associated purchase(s). Remove purchase associations first.`,
      );
    }

    return this.prisma.supplier.delete({
      where: { id },
    });
  }
}
