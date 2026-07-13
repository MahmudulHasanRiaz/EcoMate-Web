import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { StockRouterService } from '../stock/stock-router.service';
import { Prisma } from '@prisma/client';
import { CreateDispatchDto } from './dto/create-dispatch.dto';
import { DispatchQueryDto } from './dto/dispatch-query.dto';

const DISPATCH_TRANSITIONS: Record<string, string[]> = {
  DISPATCHED: ['HANDED_OVER', 'CANCELLED'],
  HANDED_OVER: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['ASSIGNED_TO_RIDER', 'CANCELLED'],
  ASSIGNED_TO_RIDER: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['PARTIAL', 'RETURN_PENDING'],
  PARTIAL: ['RETURN_PENDING', 'CANCELLED'],
  RETURN_PENDING: ['RETURNED', 'CANCELLED'],
  RETURNED: ['CANCELLED'],
  CANCELLED: [],
};

@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly stockRouter: StockRouterService,
  ) {}

  async findAll(query: DispatchQueryDto) {
    const where: Prisma.DispatchWhereInput = {};

    if (query.orderId) where.orderId = query.orderId;
    if (query.courier) where.courier = query.courier as any;
    if (query.status) where.status = query.status as any;
    if (query.search) {
      where.OR = [
        { consignmentId: { contains: query.search, mode: 'insensitive' } },
        { trackingCode: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    return this.prisma.dispatch.findMany({
      where,
      include: {
        order: {
          select: {
            id: true,
            displayId: true,
            total: true,
            guestName: true,
            guestPhone: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const dispatch = await this.prisma.dispatch.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            displayId: true,
            total: true,
            guestName: true,
            guestPhone: true,
          },
        },
      },
    });
    if (!dispatch) throw new NotFoundException('Dispatch not found');
    return dispatch;
  }

  async create(dto: CreateDispatchDto) {
    const existing = await this.prisma.dispatch.findUnique({
      where: {
        courier_consignmentId: {
          courier: dto.courier as any,
          consignmentId: dto.consignmentId,
        },
      },
    });

    if (existing && existing.status !== 'CANCELLED') {
      const flagged = await this.prisma.dispatch.create({
        data: {
          orderId: dto.orderId,
          courier: dto.courier as any,
          consignmentId: dto.consignmentId,
          trackingCode: dto.trackingCode,
          productMapping: (dto.productMapping ||
            []) as unknown as Prisma.InputJsonValue,
          notes: dto.notes,
          flaggedAt: new Date(),
        },
        include: {
          order: {
            select: {
              id: true,
              displayId: true,
              total: true,
              guestName: true,
              guestPhone: true,
            },
          },
        },
      });

      await this.prisma.courierDispatchLog.create({
        data: {
          orderId: dto.orderId,
          courier: dto.courier as any,
          status: 'DUPLICATION_FLAGGED',
          message: `Duplicate dispatch flagged. Existing: ${existing.id} (${existing.consignmentId}), New: ${flagged.id} (${dto.consignmentId}). Previous status: ${existing.status}`,
          consignmentId: dto.consignmentId,
          requestPayload: dto as any,
        },
      });

      return {
        duplicate: true,
        id: flagged.id,
        message: 'Duplicate dispatch flagged for review',
        flagged: true,
      };
    }

    return this.prisma.dispatch.create({
      data: {
        orderId: dto.orderId,
        courier: dto.courier as any,
        consignmentId: dto.consignmentId,
        trackingCode: dto.trackingCode,
        productMapping: (dto.productMapping ||
          []) as unknown as Prisma.InputJsonValue,
        notes: dto.notes,
      },
      include: {
        order: {
          select: {
            id: true,
            displayId: true,
            total: true,
            guestName: true,
            guestPhone: true,
          },
        },
      },
    });
  }

  async updateStatus(id: string, status: string, performedBy?: string) {
    // Validate transition BEFORE transaction
    const current = await this.prisma.dispatch.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new NotFoundException('Dispatch not found');
    const allowed = DISPATCH_TRANSITIONS[current.status] || [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot transition from "${current.status}" to "${status}". Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }

    const data: any = { status: status as any };
    switch (status) {
      case 'HANDED_OVER': data.handedOverAt = new Date(); break;
      case 'PICKED_UP': data.pickedUpAt = new Date(); break;
      case 'DELIVERED': data.deliveredAt = new Date(); break;
      case 'RETURNED': data.deliveredAt = null; break;
    }

    // ALL-OR-NOTHING: status claim + stock side effects in single transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic conditional update: only one request wins
      const updateResult = await tx.dispatch.updateMany({
        where: { id, status: current.status as any },
        data: {
          status: status as any,
          handedOverAt: data.handedOverAt || null,
        },
      });

      if (updateResult.count === 0) {
        return { claimed: false, dispatch: await this.findOne(id) };
      }

      // Stock operations — only if we won the claim
      const dispatch = await this.findOne(id);
      const productMapping = dispatch.productMapping as any[] | null;

      if (status === 'HANDED_OVER' || status === 'RETURNED' || status === 'DAMAGED') {
        if (status === 'RETURNED' || status === 'DAMAGED') {
          return { claimed: true, dispatch };
        }

        // HANDED_OVER: use router
        const items = productMapping && productMapping.length > 0
          ? productMapping
          : await this.getOrderItemsForStock(dispatch.orderId);

        const reference = `Dispatch DEDUCT: ${dispatch.consignmentId}`;

        for (const item of items) {
          const qty = item.quantity || 1;
          const variantId = item.productVariantId || item.variantId;
          const productId = item.productId;

          if (!productId) continue;

          const product = await tx.product.findUnique({
            where: { id: productId },
            select: { availabilityMode: true, syncManagedStock: true },
          });

          const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
          const decision = this.stockRouter.resolve(product?.availabilityMode, 'deduct', imEnabled, product?.syncManagedStock ?? undefined);

          if (decision.ms === 'deduct') {
            if (decision.msConditionalOnSync && !product?.syncManagedStock) {
              // sync=false: release reservedStock only, don't deduct managedStockQuantity
              if (variantId) {
                await this.stockService.release({ variantId, quantity: qty, reference, performedBy: performedBy || 'system', tx });
              } else {
                await this.stockService.release({ productId, quantity: qty, reference, performedBy: performedBy || 'system', tx });
              }
            } else {
              if (variantId) {
                await this.stockService.deduct({ variantId, quantity: qty, reference, performedBy: performedBy || 'system', tx });
              } else {
                await this.stockService.deduct({ productId, quantity: qty, reference, performedBy: performedBy || 'system', tx });
              }
            }
          }

          if (decision.pi === 'fulfill') {
            const prod = await tx.product.findUnique({
              where: { id: productId },
              select: { warehouseId: true },
            });
            if (prod?.warehouseId) {
              const orderItems = await tx.orderItem.findMany({
                where: { orderId: dispatch.orderId, productId },
                select: { id: true, variantId: true },
              });
              for (const oi of orderItems) {
                await this.stockService.fulfillPhysicalReservation({
                  orderId: dispatch.orderId,
                  orderItemId: oi.id,
                  quantity: qty,
                  reference,
                  performedBy: performedBy || 'system',
                  tx,
                });
                // Upgrade costType from 'estimated' to 'actual' using FIFO consumption records
                const consumptions = await tx.costingLotConsumption.findMany({
                  where: {
                    type: 'FULFILLMENT',
                    referenceType: 'ORDER_ITEM',
                    referenceId: oi.id,
                  },
                });
                if (consumptions.length > 0) {
                  const totalCost = consumptions.reduce(
                    (sum, c) => sum + Number(c.unitCost) * c.quantity, 0,
                  );
                  const totalQty = consumptions.reduce((sum, c) => sum + c.quantity, 0);
                  const actualCost = totalQty > 0 ? totalCost / totalQty : 0;
                  await tx.orderItem.update({
                    where: { id: oi.id },
                    data: {
                      costSnapshot: actualCost,
                      costType: 'actual',
                    },
                  });
                }
              }
            }
          }
        }
      }

      return { claimed: true, dispatch };
    });

    return result.dispatch;
  }

  private async getOrderItemsForStock(
    orderId: string,
  ): Promise<{ productId?: string; variantId?: string; quantity: number }[]> {
    const orderItems = await this.prisma.orderItem.findMany({
      where: { orderId },
      select: {
        productId: true,
        variantId: true,
        comboId: true,
        comboSelection: true,
        quantity: true,
      },
    });

    const items: {
      productId?: string;
      variantId?: string;
      quantity: number;
    }[] = [];

    for (const oi of orderItems) {
      if (oi.comboId) {
        const combo = await this.prisma.combo.findUnique({
          where: { id: oi.comboId },
          include: { items: true },
        });
        if (combo) {
          for (const ci of combo.items) {
            const effectiveVariantId =
              ci.variantId ||
              (oi.comboSelection as any)?.[ci.productId] ||
              null;
            items.push({
              productId: ci.productId,
              variantId: effectiveVariantId || undefined,
              quantity: ci.quantity * oi.quantity,
            });
          }
        }
      } else {
        items.push({
          productId: oi.productId || undefined,
          variantId: oi.variantId || undefined,
          quantity: oi.quantity,
        });
      }
    }

    return items;
  }

  async findFlagged() {
    return this.prisma.dispatch.findMany({
      where: { flaggedAt: { not: null } },
      orderBy: { flaggedAt: 'desc' },
      include: {
        order: {
          select: {
            displayId: true,
            total: true,
            guestName: true,
            guestPhone: true,
          },
        },
      },
    });
  }

  async resolveFlagged(
    id: string,
    action: 'accept' | 'accessories' | 'cancel',
  ) {
    const dispatch = await this.findOne(id);
    if (!dispatch.flaggedAt)
      throw new BadRequestException('Dispatch is not flagged');

    if (action === 'cancel') {
      await this.prisma.dispatch.delete({ where: { id } });
      return { message: 'Duplicate dispatch cancelled' };
    }

    const updated = await this.prisma.dispatch.update({
      where: { id },
      data: {
        flaggedAt: null,
        notes: dispatch.notes
          ? `${dispatch.notes}\n[${action === 'accessories' ? 'Accessories' : 'Accepted'}]`
          : `[${action === 'accessories' ? 'Accessories' : 'Accepted'}]`,
      },
    });
    return updated;
  }

  async remove(id: string) {
    return this.prisma.dispatch.delete({ where: { id } });
  }

  async getMetrics() {
    const [byCourier, byStatus, total] = await Promise.all([
      this.prisma.dispatch.groupBy({
        by: ['courier'],
        _count: true,
      }),
      this.prisma.dispatch.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.prisma.dispatch.count(),
    ]);

    return {
      total,
      byCourier: byCourier.map((g) => ({
        courier: g.courier,
        count: g._count,
      })),
      byStatus: byStatus.map((g) => ({ status: g.status, count: g._count })),
    };
  }
}
