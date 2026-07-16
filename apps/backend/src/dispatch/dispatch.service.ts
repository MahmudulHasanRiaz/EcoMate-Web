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

    const page = (query as any).page ? Number((query as any).page) : 1;
    const perPage = (query as any).perPage ? Number((query as any).perPage) : 10;

    const total = await this.prisma.dispatch.count({ where });
    const data = await this.prisma.dispatch.findMany({
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
      skip: (page - 1) * perPage,
      take: perPage,
    });

    return { data, total };
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

        // HANDED_OVER: deduct stock.
        // Reads the ACTIVE OrderStockCycle to find the correct reservation to fulfill.
        // Combo children are processed via OrderItemComboComponent snapshots (independent stock targets).
        const reference = `Dispatch DEDUCT: ${dispatch.consignmentId}`;
        const imEnabled = await this.stockRouter.isInventoryManagementEnabled();

        // Find the active cycle for this order
        const activeCycle = await tx.orderStockCycle.findFirst({
          where: { orderId: dispatch.orderId, status: 'ACTIVE' },
        });

        const fullOrderItems = await tx.orderItem.findMany({
          where: { orderId: dispatch.orderId },
          include: {
            product: {
              select: { id: true, availabilityMode: true, manageStock: true, syncManagedStock: true, warehouseId: true, name: true },
            },
          },
        });

        for (const oi of fullOrderItems) {
          if (!oi.productId && !oi.comboId) continue;

          // ── Combo Item: process each child snapshot independently ─────────────
          if (oi.comboId) {
            const snapshots = await tx.orderItemComboComponent.findMany({
              where: { orderItemId: oi.id },
              include: { product: true },
            });

            for (const snap of snapshots) {
              const compProduct = snap.product;
              const decision = this.stockRouter.resolve(
                compProduct.availabilityMode, 'deduct', imEnabled, compProduct.syncManagedStock ?? undefined,
              );


              // A. Managed Stock deduct (per-component flag)
              if (decision.ms === 'deduct' && !snap.managedStockDeducted) {
                if (snap.variantId) {
                  await this.stockService.deduct({
                    variantId: snap.variantId, quantity: snap.totalQuantity, reference,
                    performedBy: performedBy || 'system', tx,
                    skipCostingLotDeduct: decision.pi === 'fulfill',
                  });
                } else {
                  await this.stockService.deduct({
                    productId: snap.productId, quantity: snap.totalQuantity, reference,
                    performedBy: performedBy || 'system', tx,
                    skipCostingLotDeduct: decision.pi === 'fulfill',
                  });
                }
                await tx.orderItemComboComponent.update({
                  where: { id: snap.id },
                  data: { managedStockDeducted: true },
                });
              }

              // B. Physical reservation fulfill
              if (decision.pi === 'fulfill' && activeCycle) {
                const compRes = await tx.comboComponentPhysicalReservation.findUnique({
                  where: {
                    componentId_cycleId: { componentId: snap.id, cycleId: activeCycle.id },
                  },
                  select: { id: true, status: true },
                });

                if (compRes?.status === 'CONSUMED') continue;
                if (compRes?.status === 'ACTIVE') {
                  await this.stockService.fulfillPhysicalReservation({
                    orderId: dispatch.orderId,
                    cycleId: activeCycle.id,
                    comboComponentId: snap.id,
                    quantity: snap.totalQuantity,
                    reference,
                    performedBy: performedBy || 'system',
                    tx,
                  });
                } else if (!compRes) {
                  const hasPhysicalInventory = await tx.physicalInventory.findFirst({
                    where: { productId: snap.productId, variantId: snap.variantId || null },
                    select: { id: true },
                  });
                  if (!hasPhysicalInventory) {
                    throw new BadRequestException(
                      `"${compProduct.name}" এর Physical Inventory-তে কোনো Stock রেকর্ড নেই।`,
                    );
                  }
                  throw new BadRequestException(
                    `"${compProduct.name}" এর Combo Component Physical Reservation পাওয়া যায়নি। ` +
                    `Order Confirm স্ট্যাটাসে Physical Stock Reserve হয়নি — Dispatch করা যাবে না।`,
                  );
                }
              }
            }
            continue;
          }

          // ── Standalone Item ──────────────────────────────────────────────────
          const product = oi.product;
          if (!product || !oi.productId) continue;

          const decision = this.stockRouter.resolve(
            product.availabilityMode, 'deduct', imEnabled, product.syncManagedStock ?? undefined,
          );

          // A. Managed Stock deduct
          if (decision.ms === 'deduct' && !oi.managedStockDeducted) {
            if (oi.variantId) {
              await this.stockService.deduct({
                variantId: oi.variantId, quantity: oi.quantity, reference,
                performedBy: performedBy || 'system', tx,
                skipCostingLotDeduct: decision.pi === 'fulfill',
              });
            } else {
              await this.stockService.deduct({
                productId: oi.productId, quantity: oi.quantity, reference,
                performedBy: performedBy || 'system', tx,
                skipCostingLotDeduct: decision.pi === 'fulfill',
              });
            }
            await tx.orderItem.update({
              where: { id: oi.id },
              data: { managedStockDeducted: true },
            });
          }

          // B. Physical reservation fulfill
          if (decision.pi === 'fulfill' && activeCycle) {
            const reservation = await tx.physicalReservation.findUnique({
              where: {
                orderItemId_cycleId: { orderItemId: oi.id, cycleId: activeCycle.id },
              },
              select: { id: true, status: true },
            });

            if (reservation?.status === 'CONSUMED') continue;

            if (reservation?.status === 'ACTIVE') {
              await this.stockService.fulfillPhysicalReservation({
                orderId: dispatch.orderId,
                cycleId: activeCycle.id,
                orderItemId: oi.id,
                quantity: oi.quantity,
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
                  cycleId: activeCycle.id,
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
                  data: { costSnapshot: actualCost, costType: 'actual' },
                });
              }
              continue;
            }

            // No reservation at all — something went wrong at Confirm.
            const hasPhysicalInventory = await tx.physicalInventory.findFirst({
              where: { productId: oi.productId, variantId: oi.variantId || null },
              select: { id: true },
            });
            if (!hasPhysicalInventory) {
              throw new BadRequestException(
                `"${product.name}" এর Physical Inventory-তে কোনো Stock রেকর্ড নেই। ` +
                `Inventory Management চালু থাকলে Physical Stock ছাড়া Dispatch করা যাবে না।`,
              );
            }
            throw new BadRequestException(
              `"${product.name}" এর Physical Reservation পাওয়া যায়নি। ` +
              `Order Confirm স্ট্যাটাসে Physical Stock Reserve হয়নি — Dispatch করা যাবে না।`,
            );
          }
        }
      }


      // IN_TRANSIT: recheck that deduction was applied (like Confirmed rechecks reservation).
      // If any managed stock deduction was missed, retry it now.
      if (status === 'IN_TRANSIT') {
        const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
        const reference = `In Transit DEDUCT RECHECK: ${dispatch.consignmentId}`;

        // Load active cycle for cycle-scoped reservation lookup
        const activeCycleForTransit = await tx.orderStockCycle.findFirst({
          where: { orderId: dispatch.orderId, status: 'ACTIVE' },
        });

        const orderItems = await tx.orderItem.findMany({
          where: { orderId: dispatch.orderId },
          include: {
            product: {
              select: { id: true, availabilityMode: true, manageStock: true, syncManagedStock: true, warehouseId: true, name: true },
            },
          },
        });

        for (const oi of orderItems) {
          if (!oi.productId && !oi.comboId) continue;

          // ── Combo Item: recheck/repair each child snapshot independently ─────
          if (oi.comboId) {
            const snapshots = await tx.orderItemComboComponent.findMany({
              where: { orderItemId: oi.id },
              include: { product: true },
            });

            for (const snap of snapshots) {
              const compProduct = snap.product;
              const decision = this.stockRouter.resolve(
                compProduct.availabilityMode, 'deduct', imEnabled, compProduct.syncManagedStock ?? undefined,
              );

              // If managed stock should have been deducted but wasn't, do it now
              if (decision.ms === 'deduct' && !snap.managedStockDeducted) {
                if (snap.variantId) {
                  await this.stockService.deduct({
                    variantId: snap.variantId, quantity: snap.totalQuantity, reference,
                    performedBy: performedBy || 'system', tx,
                    skipCostingLotDeduct: decision.pi === 'fulfill',
                  });
                } else {
                  await this.stockService.deduct({
                    productId: snap.productId, quantity: snap.totalQuantity, reference,
                    performedBy: performedBy || 'system', tx,
                    skipCostingLotDeduct: decision.pi === 'fulfill',
                  });
                }
                await tx.orderItemComboComponent.update({
                  where: { id: snap.id },
                  data: { managedStockDeducted: true },
                });
              }

              // Verify physical reservation was fulfilled (CONSUMED) if applicable
              if (decision.pi === 'fulfill' && activeCycleForTransit) {
                const compRes = await tx.comboComponentPhysicalReservation.findUnique({
                  where: {
                    componentId_cycleId: { componentId: snap.id, cycleId: activeCycleForTransit.id },
                  },
                  select: { status: true },
                });
                if (compRes && compRes.status !== 'CONSUMED') {
                  throw new BadRequestException(
                    `"${compProduct.name}" এর Physical Stock Deduction এখনও সম্পন্ন হয়নি। ` +
                    `In Transit-এ যাওয়ার আগে Handed Over স্ট্যাটাসে Physical Stock ডিডাক্ট হওয়া প্রয়োজন।`,
                  );
                }
              }
            }
            continue;
          }

          // ── Standalone Item ──────────────────────────────────────────────────
          const product = oi.product;
          if (!product || !oi.productId) continue;

          const decision = this.stockRouter.resolve(
            product.availabilityMode, 'deduct', imEnabled, product.syncManagedStock ?? undefined,
          );

          // If managed stock should have been deducted but wasn't, do it now
          if (decision.ms === 'deduct' && !oi.managedStockDeducted) {
            if (oi.variantId) {
              await this.stockService.deduct({
                variantId: oi.variantId, quantity: oi.quantity, reference,
                performedBy: performedBy || 'system', tx,
                skipCostingLotDeduct: decision.pi === 'fulfill',
              });
            } else {
              await this.stockService.deduct({
                productId: oi.productId, quantity: oi.quantity, reference,
                performedBy: performedBy || 'system', tx,
                skipCostingLotDeduct: decision.pi === 'fulfill',
              });
            }
            await tx.orderItem.update({
              where: { id: oi.id },
              data: { managedStockDeducted: true },
            });
          }

          // Verify physical reservation was fulfilled (CONSUMED) if applicable
          if (decision.pi === 'fulfill' && activeCycleForTransit) {
            const reservation = await tx.physicalReservation.findUnique({
              where: {
                orderItemId_cycleId: { orderItemId: oi.id, cycleId: activeCycleForTransit.id },
              },
              select: { status: true },
            });
            if (reservation && reservation.status !== 'CONSUMED') {
              throw new BadRequestException(
                `"${product.name}" এর Physical Stock Deduction এখনও সম্পন্ন হয়নি। ` +
                `In Transit-এ যাওয়ার আগে Handed Over স্ট্যাটাসে Physical Stock ডিডাক্ট হওয়া প্রয়োজন।`,
              );
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
