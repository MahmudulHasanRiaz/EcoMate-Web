import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PackingService {
  private readonly LOCK_DURATION_MS = 30 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async getQueue(search?: string) {
    const confirmedStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Confirmed' } });
    const holdStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Packing Hold' } });
    if (!confirmedStatus || !holdStatus) throw new NotFoundException('Required statuses not found');

    const where: any = {
      statusId: { in: [confirmedStatus.id, holdStatus.id] }
    };
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
        items: {
          include: {
            variant: {
              include: {
                product: true,
                attributeValues: { include: { attributeValue: true } },
              },
            },
          },
        },
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
        const variantAttrs = i.variant?.attributeValues
          ? i.variant.attributeValues.map((av: any) => av.attributeValue?.value).filter(Boolean).join(' / ')
          : '';
        return {
          id: i.id,
          productName: i.variant?.product?.name ?? 'Unknown',
          variantName: variantAttrs || '',
          sku: i.variant?.sku ?? '',
          quantity: i.quantity,
          image: i.variant?.image || (Array.isArray(productImages) && typeof productImages[0] === 'string' ? productImages[0] : null),
        };
      }),
      totalItems: o.items.reduce((sum, i) => sum + i.quantity, 0),
      packingLock: o.packingLock ? {
        packerId: o.packingLock.packerId,
        packerName: `${o.packingLock.packer.firstName} ${o.packingLock.packer.lastName}`,
        startedAt: o.packingLock.startedAt,
        expiresAt: o.packingLock.expiresAt,
      } : null,
      statusName: o.status.name,
      statusColor: o.status.color,
      createdAt: o.createdAt,
    }));
  }

  async openOrder(orderId: string, packerId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { packingLock: true, status: { select: { name: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status.name !== 'Confirmed' && order.status.name !== 'Packing Hold') {
      throw new BadRequestException('Order is not in Confirmed or Packing Hold status');
    }

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

  async markDone(orderId: string, packerId: string, verificationMode: string) {
    const lock = await this.prisma.packingLock.findUnique({ where: { orderId } });
    if (!lock) throw new BadRequestException('Order is not opened for packing');
    if (lock.packerId !== packerId) throw new ConflictException('Order is locked by another packer');

    const packedStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Packed' } });
    if (!packedStatus) throw new NotFoundException('Packed status not found');

    const packer = await this.prisma.userProfile.findUnique({
      where: { id: packerId },
      select: { firstName: true, lastName: true }
    });
    const packerName = packer ? `${packer.firstName} ${packer.lastName}` : 'System Packer';

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { timeline: true }
    });
    const existingTimeline = Array.isArray(order?.timeline) ? order.timeline : [];
    const newEntry = {
      type: 'status',
      status: 'Packed',
      timestamp: new Date().toISOString(),
      note: `Order packed successfully. Verification mode: ${verificationMode}.`,
      performedBy: packerName,
    };
    const updatedTimeline = [...existingTimeline, newEntry];

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { 
          statusId: packedStatus.id, 
          assignedToId: packerId,
          timeline: updatedTimeline as any
        },
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

    const packer = await this.prisma.userProfile.findUnique({
      where: { id: packerId },
      select: { firstName: true, lastName: true }
    });
    const packerName = packer ? `${packer.firstName} ${packer.lastName}` : 'System Packer';

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { timeline: true }
    });
    const existingTimeline = Array.isArray(order?.timeline) ? order.timeline : [];
    const newEntry = {
      type: 'status',
      status: 'Packing Hold',
      timestamp: new Date().toISOString(),
      note: `Order placed on packing hold. Reason: ${reason}. Notes: ${notes ?? 'N/A'}`,
      performedBy: packerName,
    };
    const updatedTimeline = [...existingTimeline, newEntry];

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { 
          statusId: holdStatus.id, 
          assignedToId: packerId, 
          officeNotes: notes ?? '',
          timeline: updatedTimeline as any
        },
      }),
      this.prisma.packingLock.delete({ where: { orderId } }),
    ]);

    return { success: true, orderId, reason, notes };
  }

  async releaseLock(orderId: string, packerId: string) {
    const lock = await this.prisma.packingLock.findUnique({ where: { orderId } });
    if (!lock) return { success: true };
    if (lock.packerId !== packerId) {
      throw new ConflictException('Cannot release lock held by another packer');
    }
    await this.prisma.packingLock.delete({ where: { orderId } });
    return { success: true };
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
    if (!packedStatus || !holdStatus || !confirmedStatus) {
      throw new NotFoundException('Required order status not found');
    }

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
    if (!packedStatus || !holdStatus) {
      throw new NotFoundException('Required order status not found');
    }

    const where = packerId ? { assignedToId: packerId } : {};

    const orders = await this.prisma.order.findMany({
      where: {
        ...where,
        statusId: { in: [packedStatus.id, holdStatus.id] },
      },
      include: {
        status: true,
        assignee: { select: { firstName: true, lastName: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    return orders.map((o) => ({
      id: o.id,
      displayId: o.displayId,
      statusName: o.status.name,
      statusColor: o.status.color,
      packerName: o.assignee ? `${o.assignee.firstName} ${o.assignee.lastName}` : 'N/A',
      updatedAt: o.updatedAt,
    }));
  }

  async checkOrderStatus(code: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [
          { id: code },
          { displayId: { equals: code, mode: 'insensitive' } }
        ]
      },
      include: {
        status: { select: { name: true } }
      }
    });

    if (!order) {
      return { exists: false };
    }

    return {
      exists: true,
      displayId: order.displayId,
      status: order.status.name
    };
  }
}
