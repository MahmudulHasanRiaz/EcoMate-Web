import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

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

  async findAll(activeOnly = false) {
    return this.prisma.supplier.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { purchases: true }
        }
      }
    });
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        _count: {
          select: { purchases: true }
        },
        payments: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            invoices: true
          }
        }
      }
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

    const now = new Date();
    const dateStr = `${now.getFullYear().toString().slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      const lastInvoice = await tx.supplierPaymentInvoice.findFirst({
        orderBy: { id: 'desc' },
      });

      let nextSeq = 1;
      if (lastInvoice) {
        const parts = lastInvoice.invoiceNo.split('-');
        if (parts.length === 3 && parts[0] === 'PINV' && parts[1] === dateStr) {
          nextSeq = parseInt(parts[2], 10) + 1;
        }
      }

      const invoiceNo = `PINV-${dateStr}-${String(nextSeq).padStart(4, '0')}`;

      const payment = await tx.supplierPayment.create({
        data: {
          supplierId,
          amount: dto.amount,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          paymentMethod: dto.paymentMethod,
          reference: dto.reference,
          notes: dto.notes,
          invoices: {
            create: { invoiceNo }
          }
        },
        include: { invoices: true }
      });

      await tx.supplier.update({
        where: { id: supplierId },
        data: {
          totalPaid: { increment: dto.amount },
          balance: { decrement: dto.amount },
        },
      });

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
    await this.findOne(id);
    return this.prisma.supplier.delete({
      where: { id },
    });
  }
}
