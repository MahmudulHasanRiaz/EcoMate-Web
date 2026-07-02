import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { CreateGrnDto } from './dto/create-grn.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { PurchaseStatus, Prisma } from '@prisma/client';

@Injectable()
export class PurchasesService {
  constructor(
    private prisma: PrismaService,
    private stockService: StockService,
  ) {}

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

  private async generateGrnNumber(): Promise<string> {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const prefix = `GRN-${yy}${mm}${dd}-`;

    const last = await this.prisma.goodsReceiptNote.findFirst({
      where: { grnNumber: { startsWith: prefix } },
      orderBy: { grnNumber: 'desc' },
      select: { grnNumber: true },
    });

    let seq = 1;
    if (last) {
      const parts = last.grnNumber.split('-');
      seq = parseInt(parts[parts.length - 1], 10) + 1;
    }

    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  private async generateLotNumber(): Promise<string> {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const prefix = `LOT-${yy}${mm}${dd}-`;

    const last = await this.prisma.costingLot.findFirst({
      where: { lotNumber: { startsWith: prefix } },
      orderBy: { lotNumber: 'desc' },
      select: { lotNumber: true },
    });

    let seq = 1;
    if (last) {
      const parts = last.lotNumber.split('-');
      seq = parseInt(parts[parts.length - 1], 10) + 1;
    }

    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  async create(dto: CreatePurchaseDto) {
    // Always generate a system PO number — user's reference goes into notes
    const poNumber = await this.generateReferenceNo();
    const vendorRef = dto.referenceNo || '';
    const notesWithRef = vendorRef
      ? `Vendor Ref: ${vendorRef}\n${dto.notes || ''}`
      : dto.notes || '';

    return this.prisma.$transaction(async (tx) => {
      const items = dto.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice: new Prisma.Decimal(item.totalBill / item.quantity),
        totalPrice: new Prisma.Decimal(item.totalBill),
        totalBill: new Prisma.Decimal(item.totalBill),
        receivedQty: 0,
      }));

      const subtotal = dto.items.reduce((sum, item) => sum + item.totalBill, 0);

      return tx.purchase.create({
        data: {
          supplierId: dto.supplierId,
          referenceNo: poNumber,
          orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date(),
          expectedDate: dto.expectedDate
            ? new Date(dto.expectedDate)
            : undefined,
          status: PurchaseStatus.ordered,
          subtotal: new Prisma.Decimal(subtotal),
          taxAmount: 0,
          discount: 0,
          total: new Prisma.Decimal(subtotal),
          paidAmount: 0,
          notes: notesWithRef,
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
    const where: Record<string, unknown> = {};

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
          grns: true,
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
        costingLots: true,
        grns: {
          include: {
            items: true,
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
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!purchase) {
      throw new NotFoundException(`Purchase with ID ${id} not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};

      if (dto.supplierId !== undefined) data.supplierId = dto.supplierId;
      if (dto.orderDate !== undefined) data.orderDate = new Date(dto.orderDate);
      if (dto.expectedDate !== undefined)
        data.expectedDate = new Date(dto.expectedDate);
      if (dto.notes !== undefined) data.notes = dto.notes;

      if (dto.items) {
        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });

        const newItems = dto.items.map((item) => ({
          purchaseId: id,
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: new Prisma.Decimal(item.totalBill / item.quantity),
          totalPrice: new Prisma.Decimal(item.totalBill),
          totalBill: new Prisma.Decimal(item.totalBill),
          receivedQty: 0,
        }));

        await tx.purchaseItem.createMany({ data: newItems });

        const subtotal = dto.items.reduce(
          (sum, item) => sum + item.totalBill,
          0,
        );
        data.subtotal = new Prisma.Decimal(subtotal);
        data.total = new Prisma.Decimal(subtotal);
      }

      return tx.purchase.update({
        where: { id },
        data,
        include: {
          supplier: true,
          items: true,
          grns: true,
        },
      });
    });
  }

  async remove(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!purchase) {
      throw new NotFoundException(`Purchase with ID ${id} not found`);
    }

    return this.prisma.purchase.delete({ where: { id } });
  }

  async createGrn(purchaseId: string, dto: CreateGrnDto, userId?: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: { items: true },
    });

    if (!purchase) {
      throw new NotFoundException(`Purchase with ID ${purchaseId} not found`);
    }

    if (purchase.status === PurchaseStatus.cancelled) {
      throw new ConflictException('Cannot create GRN for a cancelled purchase');
    }

    const grnNumber = await this.generateGrnNumber();

    return this.prisma.$transaction(async (tx) => {
      const itemIds = dto.items.map((i) => i.purchaseItemId);
      const purchaseItems = await tx.purchaseItem.findMany({
        where: { id: { in: itemIds }, purchaseId },
      });

      const piMap = new Map(purchaseItems.map((pi) => [pi.id, pi]));

      for (const d of dto.items) {
        const pi = piMap.get(d.purchaseItemId);
        if (!pi) {
          throw new NotFoundException(
            `Purchase item ${d.purchaseItemId} not found in purchase`,
          );
        }

        const newReceivedQty = pi.receivedQty + d.receivedQty;
        if (newReceivedQty > pi.quantity) {
          throw new ConflictException(
            `Received qty (${newReceivedQty}) exceeds ordered qty (${pi.quantity}) for item ${d.purchaseItemId}`,
          );
        }
      }

      const grn = await tx.goodsReceiptNote.create({
        data: {
          grnNumber,
          purchaseId,
          receivedBy: userId,
          status: 'received',
          notes: dto.notes,
          items: {
            create: dto.items.map((d) => {
              const pi = piMap.get(d.purchaseItemId)!;
              const unitCost = new Prisma.Decimal(
                Number(pi.totalBill) / Number(pi.quantity),
              );
              return {
                purchaseItemId: d.purchaseItemId,
                productId: d.productId,
                variantId: d.variantId,
                expectedQty: pi.quantity,
                receivedQty: d.receivedQty,
                acceptedQty: d.acceptedQty,
                rejectedQty: d.rejectedQty,
                unitCost,
                totalCost: unitCost.mul(d.acceptedQty),
              };
            }),
          },
        },
        include: { items: true },
      });

      for (const d of dto.items) {
        await tx.purchaseItem.update({
          where: { id: d.purchaseItemId },
          data: { receivedQty: { increment: d.receivedQty } },
        });
      }

      for (const d of dto.items) {
        if (d.acceptedQty <= 0) continue;

        const pi = piMap.get(d.purchaseItemId)!;
        const unitCost = new Prisma.Decimal(
          Number(pi.totalBill) / Number(pi.quantity),
        );
        const lotNumber = await this.generateLotNumber();

        await tx.costingLot.create({
          data: {
            purchaseId,
            grnId: grn.id,
            productId: d.productId,
            variantId: d.variantId,
            lotNumber,
            unitCost,
            totalCost: unitCost.mul(d.acceptedQty),
            quantity: d.acceptedQty,
            remainingQty: d.acceptedQty,
          },
        });
      }

      for (const d of dto.items) {
        if (d.acceptedQty <= 0) continue;

        await this.stockService.add({
          productId: d.productId,
          variantId: d.variantId,
          quantity: d.acceptedQty,
          reference: `GRN-${grnNumber}`,
          performedBy: userId,
          tx,
        });
      }

      const grnTotalCost = dto.items.reduce((sum, d) => {
        const pi = piMap.get(d.purchaseItemId)!;
        const unitCost = Number(pi.totalBill) / Number(pi.quantity);
        return sum + unitCost * d.acceptedQty;
      }, 0);

      await tx.supplier.update({
        where: { id: purchase.supplierId },
        data: {
          totalPurchases: { increment: new Prisma.Decimal(grnTotalCost) },
          balance: { increment: new Prisma.Decimal(grnTotalCost) },
        },
      });

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

      await tx.purchase.update({
        where: { id: purchaseId },
        data: { status: newStatus },
      });

      return grn;
    });
  }

  async getGrns(purchaseId: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
      select: { id: true },
    });

    if (!purchase) {
      throw new NotFoundException(`Purchase with ID ${purchaseId} not found`);
    }

    return this.prisma.goodsReceiptNote.findMany({
      where: { purchaseId },
      include: {
        items: true,
        costingLots: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getGrn(grnId: string) {
    const grn = await this.prisma.goodsReceiptNote.findUnique({
      where: { id: grnId },
      include: {
        items: true,
        costingLots: true,
        purchase: {
          include: {
            supplier: true,
            items: true,
          },
        },
      },
    });

    if (!grn) {
      throw new NotFoundException(`GRN with ID ${grnId} not found`);
    }

    return grn;
  }
}
