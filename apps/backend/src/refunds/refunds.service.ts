import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateRefundDto, UpdateRefundStatusDto } from './dto/refund.dto';

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['approved', 'rejected'],
  approved: ['completed', 'rejected'],
  completed: [],
  rejected: [],
};

@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  async findAll(query: {
    page?: number;
    perPage?: number;
    status?: string;
    orderId?: string;
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 10;
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.orderId) where.orderId = query.orderId;

    const [data, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { displayId: true } },
          processor: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.refund.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id },
      include: {
        order: { select: { displayId: true } },
        processor: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    return refund;
  }

  async create(dto: CreateRefundDto) {
    await this.prisma.order.findUniqueOrThrow({ where: { id: dto.orderId } });
    return this.prisma.refund.create({
      data: {
        orderId: dto.orderId,
        amount: dto.amount,
        reason: dto.reason,
        notes: dto.notes,
      },
      include: {
        order: { select: { displayId: true } },
        processor: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async updateStatus(
    id: string,
    dto: UpdateRefundStatusDto,
    processedBy: string,
  ) {
    const refund = await this.prisma.refund.findUnique({ where: { id } });
    if (!refund) throw new NotFoundException('Refund not found');

    const allowed = VALID_TRANSITIONS[refund.status];
    if (!allowed || !allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from "${refund.status}" to "${dto.status}". Allowed: ${allowed?.join(', ') || 'none'}`,
      );
    }

    const updated = await this.prisma.refund.update({
      where: { id },
      data: {
        status: dto.status,
        processedBy,
        processedAt: new Date(),
        notes: dto.notes ?? refund.notes,
      },
      include: {
        order: { select: { id: true, displayId: true } },
        processor: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (dto.status === 'completed') {
      await this.restockOrderItems(updated.order.id, processedBy);
    }

    return updated;
  }

  private async restockOrderItems(orderId: string, performedBy: string) {
    const orderItems = await this.prisma.orderItem.findMany({
      where: { orderId },
    });

    for (const item of orderItems) {
      if (item.comboId) {
        const combo = await this.prisma.combo.findUnique({
          where: { id: item.comboId },
          include: { items: true },
        });
        if (!combo) continue;

        if (combo.manageStock) {
          await this.prisma.combo.update({
            where: { id: item.comboId },
            data: { stock: { increment: item.quantity } },
          });
          await this.prisma.inventoryLog.create({
            data: {
              comboId: item.comboId,
              quantity: item.quantity,
              type: 'refund_restock',
              reason: `Refund restock for order ${orderId}`,
              performedBy,
              createdAt: new Date(),
            },
          });
        }

        for (const ci of combo.items) {
          const qty = ci.quantity * item.quantity;
          if (ci.variantId) {
            await this.prisma.productVariant.update({
              where: { id: ci.variantId },
              data: { stock: { increment: qty } },
            });
          }
          const product = await this.prisma.product.findUnique({
            where: { id: ci.productId },
            select: { manageStock: true },
          });
          if (product?.manageStock) {
            await this.prisma.product.update({
              where: { id: ci.productId },
              data: { stock: { increment: qty } },
            });
          }
          await this.prisma.inventoryLog.create({
            data: {
              productId: ci.productId,
              variantId: ci.variantId,
              comboId: item.comboId,
              quantity: qty,
              type: 'refund_restock',
              reason: `Refund restock for order ${orderId}`,
              performedBy,
              createdAt: new Date(),
            },
          });
        }
      } else {
        if (item.variantId) {
          await this.prisma.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        }
        const product = item.productId
          ? await this.prisma.product.findUnique({
              where: { id: item.productId },
              select: { manageStock: true, type: true },
            })
          : null;
        if (product && product.manageStock && (!item.variantId || product.type === 'simple')) {
          await this.prisma.product.update({
            where: { id: item.productId! },
            data: { stock: { increment: item.quantity } },
          });
        }
        await this.prisma.inventoryLog.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            type: 'refund_restock',
            reason: `Refund restock for order ${orderId}`,
            performedBy,
            createdAt: new Date(),
          },
        });
      }
    }
  }
}
