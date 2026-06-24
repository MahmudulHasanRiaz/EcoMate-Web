import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { PurchaseStatus, Prisma } from '@prisma/client';

@Injectable()
export class PurchasesService {
  constructor(private prisma: PrismaService) {}

  private async generateReferenceNo(): Promise<string> {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const prefix = `PO-${yy}${mm}${dd}-`;

    const last = await this.prisma.purchase.findFirst({
      where: { referenceNo: { startsWith: prefix } },
      orderBy: { referenceNo: 'desc' },
      select: { referenceNo: true },
    });

    let seq = 1;
    if (last) {
      const parts = last.referenceNo.split('-');
      seq = parseInt(parts[parts.length - 1], 10) + 1;
    }

    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  async create(dto: CreatePurchaseDto) {
    const existing = await this.prisma.purchase.findUnique({
      where: { referenceNo: dto.referenceNo },
    });

    if (existing) {
      throw new ConflictException('Purchase with this reference number already exists');
    }

    const referenceNo = dto.referenceNo || (await this.generateReferenceNo());

    return this.prisma.$transaction(async (tx) => {
      const items = dto.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: new Prisma.Decimal(item.quantity * item.unitPrice),
        receivedQty: 0,
      }));

      return tx.purchase.create({
        data: {
          supplierId: dto.supplierId,
          referenceNo,
          orderDate: dto.orderDate || new Date(),
          expectedDate: dto.expectedDate,
          status: dto.status || PurchaseStatus.draft,
          subtotal: dto.subtotal,
          taxAmount: dto.taxAmount || 0,
          discount: dto.discount || 0,
          total: dto.total,
          paidAmount: dto.paidAmount || 0,
          notes: dto.notes,
          items: {
            create: items,
          },
        },
        include: {
          supplier: true,
          items: true,
        },
      });
    });
  }

  async findAll(page = 1, perPage = 10, status?: string, supplierId?: string) {
    const where: any = {};

    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;

    const [data, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: true,
          items: true,
        },
      }),
      this.prisma.purchase.count({ where }),
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
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: {
          include: {
            product: true,
            variant: true,
          },
        },
      },
    });

    if (!purchase) {
      throw new NotFoundException(`Purchase with ID ${id} not found`);
    }

    return purchase;
  }

  async update(id: string, dto: UpdatePurchaseDto) {
    await this.findOne(id);

    if (dto.referenceNo) {
      const existing = await this.prisma.purchase.findUnique({
        where: { referenceNo: dto.referenceNo },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Purchase with this reference number already exists');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const { items, ...purchaseData } = dto;

      if (items) {
        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });

        const newItems = items.map((item) => ({
          purchaseId: id,
          productId: item.productId,
          variantId: item.variantId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: new Prisma.Decimal(item.quantity * item.unitPrice),
          receivedQty: 0,
        }));

        await tx.purchaseItem.createMany({ data: newItems });
      }

      return tx.purchase.update({
        where: { id },
        data: purchaseData,
        include: {
          supplier: true,
          items: true,
        },
      });
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.purchase.delete({ where: { id } });
  }

  async receiveItems(
    purchaseId: string,
    items: { itemId: string; receivedQty: number }[],
  ) {
    const purchase = await this.findOne(purchaseId);

    if (purchase.status === PurchaseStatus.cancelled) {
      throw new ConflictException('Cannot receive items for a cancelled purchase');
    }

    return this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const purchaseItem = await tx.purchaseItem.findUnique({
          where: { id: item.itemId },
        });

        if (!purchaseItem || purchaseItem.purchaseId !== purchaseId) {
          throw new NotFoundException(`Purchase item with ID ${item.itemId} not found`);
        }

        const newReceivedQty = purchaseItem.receivedQty + item.receivedQty;

        if (newReceivedQty > purchaseItem.quantity) {
          throw new ConflictException(
            `Received quantity (${newReceivedQty}) cannot exceed ordered quantity (${purchaseItem.quantity}) for item ${item.itemId}`,
          );
        }

        await tx.purchaseItem.update({
          where: { id: item.itemId },
          data: { receivedQty: newReceivedQty },
        });
      }

      const allItems = await tx.purchaseItem.findMany({
        where: { purchaseId },
      });

      const allReceived = allItems.every((i) => i.receivedQty >= i.quantity);
      const anyReceived = allItems.some((i) => i.receivedQty > 0);

      let newStatus: PurchaseStatus;
      if (allReceived) {
        newStatus = PurchaseStatus.received;
      } else if (anyReceived) {
        newStatus = PurchaseStatus.partially_received;
      } else {
        newStatus = purchase.status;
      }

      return tx.purchase.update({
        where: { id: purchaseId },
        data: { status: newStatus },
        include: {
          supplier: true,
          items: true,
        },
      });
    });
  }

  async updateStatus(id: string, status: PurchaseStatus) {
    await this.findOne(id);

    return this.prisma.purchase.update({
      where: { id },
      data: { status },
      include: {
        supplier: true,
        items: true,
      },
    });
  }
}
