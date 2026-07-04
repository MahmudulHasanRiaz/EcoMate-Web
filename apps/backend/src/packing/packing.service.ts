import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PackingService {
  private readonly LOCK_DURATION_MS = 30 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async getQueue(search?: string) {
    const confirmedStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Confirmed' } });
    if (!confirmedStatus) throw new NotFoundException('Confirmed status not found');

    const where: any = { statusId: confirmedStatus.id };
    if (search) {
      where.OR = [
        { displayId: { contains: search, mode: 'insensitive' } },
        { guestName: { contains: search, mode: 'insensitive' } },
        { guestPhone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        items: { include: { variant: { include: { product: true } } } },
        packingLock: { include: { packer: { select: { id: true, firstName: true, lastName: true } } } },
        customer: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
        status: { select: { id: true, name: true, color: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return orders.map((o) => ({
      id: o.id,
      displayId: o.displayId,
      customer: o.customer
        ? { id: o.customer.id, name: `${o.customer.firstName} ${o.customer.lastName}`, phone: o.customer.phoneNumber }
        : o.guestName
          ? { name: o.guestName, phone: o.guestPhone }
          : null,
      items: o.items.map((i) => {
        const productImages = i.variant?.product?.images as any[] | null | undefined;
        return {
          id: i.id,
          productName: i.variant?.product?.name ?? 'Unknown',
          variantName: i.variant?.sku ?? '',
          quantity: i.quantity,
          image: productImages?.[0]?.url ?? null,
        };
      }),
      totalItems: o.items.reduce((sum, i) => sum + i.quantity, 0),
      packingLock: o.packingLock ? {
        packerId: o.packingLock.packerId,
        packerName: `${o.packingLock.packer.firstName} ${o.packingLock.packer.lastName}`,
        startedAt: o.packingLock.startedAt,
        expiresAt: o.packingLock.expiresAt,
      } : null,
      createdAt: o.createdAt,
    }));
  }

  async openOrder(orderId: string, packerId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { packingLock: true, status: { select: { name: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status.name !== 'Confirmed') throw new BadRequestException('Order is not in Confirmed status');

    const existingLock = order.packingLock;
    if (existingLock && existingLock.packerId !== packerId) {
      const isExpired = existingLock.expiresAt && new Date() > existingLock.expiresAt;
      if (!isExpired) {
        throw new ConflictException('Order is being packed by another user');
      }
    }

    const expiresAt = new Date(Date.now() + this.LOCK_DURATION_MS);
    const lock = await this.prisma.packingLock.upsert({
      where: { orderId },
      update: { packerId, startedAt: new Date(), expiresAt },
      create: { orderId, packerId, expiresAt },
    });

    return lock;
  }

  async markDone(orderId: string, packerId: string) {
    const lock = await this.prisma.packingLock.findUnique({ where: { orderId } });
    if (!lock) throw new BadRequestException('Order is not opened for packing');
    if (lock.packerId !== packerId) throw new ConflictException('Order is locked by another packer');

    const packedStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Packed' } });
    if (!packedStatus) throw new NotFoundException('Packed status not found');

    const [result] = await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { statusId: packedStatus.id },
      }),
      this.prisma.packingLock.delete({ where: { orderId } }),
    ]);

    return { success: true, orderId };
  }

  async markHold(orderId: string, packerId: string, reason: string, notes?: string) {
    const lock = await this.prisma.packingLock.findUnique({ where: { orderId } });
    if (!lock) throw new BadRequestException('Order is not opened for packing');
    if (lock.packerId !== packerId) throw new ConflictException('Order is locked by another packer');

    const holdStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Packing Hold' } });
    if (!holdStatus) throw new NotFoundException('Packing Hold status not found');

    const [result] = await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { statusId: holdStatus.id, officeNotes: notes ?? '' },
      }),
      this.prisma.packingLock.delete({ where: { orderId } }),
    ]);

    return { success: true, orderId, reason, notes };
  }

  async getActiveLocks() {
    const locks = await this.prisma.packingLock.findMany({
      include: {
        order: { select: { id: true, displayId: true } },
        packer: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return locks.map((l) => ({
      id: l.id,
      orderId: l.orderId,
      displayId: l.order.displayId,
      packerName: `${l.packer.firstName} ${l.packer.lastName}`,
      startedAt: l.startedAt,
      expiresAt: l.expiresAt,
      isExpired: l.expiresAt ? new Date() > l.expiresAt : false,
    }));
  }

  async getStats(packerId?: string) {
    const packedStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Packed' } });
    const holdStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Packing Hold' } });
    const confirmedStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Confirmed' } });

    const where = packerId ? { assignedToId: packerId } : {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [packedCount, holdCount, pendingCount] = await Promise.all([
      this.prisma.order.count({ where: { ...where, statusId: packedStatus!.id, updatedAt: { gte: today } } }),
      this.prisma.order.count({ where: { ...where, statusId: holdStatus!.id, updatedAt: { gte: today } } }),
      this.prisma.order.count({ where: { statusId: confirmedStatus!.id } }),
    ]);

    return { packed: packedCount, held: holdCount, pending: pendingCount };
  }

  async getHistory(packerId?: string) {
    const packedStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Packed' } });
    const holdStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Packing Hold' } });

    const where: any = {
      OR: [{ statusId: packedStatus!.id }, { statusId: holdStatus!.id }],
    };
    if (packerId) where.assignedToId = packerId;

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        status: { select: { name: true, color: true } },
        assignee: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    return orders.map((o) => ({
      id: o.id,
      displayId: o.displayId,
      status: o.status.name,
      statusColor: o.status.color,
      packerName: o.assignee ? `${o.assignee.firstName} ${o.assignee.lastName}` : 'N/A',
      updatedAt: o.updatedAt,
    }));
  }
}
