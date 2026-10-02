import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { startOfDhakaDay } from '../common/utils/dhaka-time';

export const PACKING_QUEUE_PAGE_SIZE = 100;

/**
 * Everything the packing workspace needs to render one order.
 *
 * `items.product` is the canonical catalog source: it carries the full
 * variant + attribute tree used for color-sibling image resolution.
 * `variant.product` is fetched as scalars only — including the whole tree
 * there repeated the same product/variants/attributes per line, doubling both
 * query cost and payload for no extra information.
 *
 * Shared by `getQueue` and `getOrderDetail` so a single order renders
 * identically to one inside the queue page.
 */
const QUEUE_ORDER_INCLUDE = {
  items: {
    include: {
      product: {
        include: {
          variants: {
            include: {
              attributeValues: {
                include: {
                  attributeValue: {
                    include: { attribute: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
      },
      variant: {
        include: {
          product: {
            select: { id: true, name: true, images: true },
          },
          attributeValues: {
            include: {
              attributeValue: {
                include: { attribute: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  },
  packingLock: {
    include: {
      packer: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  },
  customer: { select: { id: true, name: true, phone: true } },
  status: { select: { id: true, name: true, color: true } },
} as const;

/** Resolve an image URL from either a plain string or an object form. */
function resolveImage(img: any): string | null {
  if (typeof img === 'string') return img.trim() || null;
  if (img && typeof img === 'object') {
    return (
      (typeof img.url === 'string' && img.url.trim()) ||
      (typeof img.path === 'string' && img.path.trim()) ||
      null
    );
  }
  return null;
}

/** First non-empty image in a list. */
function firstOf(list: any): string | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  for (const entry of list) {
    const resolved = resolveImage(entry);
    if (resolved) return resolved;
  }
  return null;
}

function slimAttrs(avs: any[]) {
  return avs.map((av: any) => ({
    attributeValue: av?.attributeValue
      ? {
          value: av.attributeValue.value ?? null,
          hexCode: av.attributeValue.hexCode ?? null,
          attribute: { name: av.attributeValue.attribute?.name ?? null },
        }
      : null,
  }));
}

function slimVariant(v: any) {
  return {
    id: v?.id ?? null,
    image: typeof v?.image === 'string' ? v.image : null,
    images: v?.images ?? null,
    attributeValues: slimAttrs(v?.attributeValues ?? []),
  };
}

@Injectable()
export class PackingService {
  private readonly logger = new Logger(PackingService.name);
  private readonly LOCK_DURATION_MS = 30 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Deletes locks whose lease has elapsed. Only `openOrder` ever overwrote a
   * lock row, so an order that was locked and then abandoned stayed flagged as
   * "being packed" in the queue forever, with no way for anyone to clear it.
   * Best-effort: a failure here must never break the queue.
   */
  private async pruneExpiredLocks() {
    try {
      await this.prisma.packingLock.deleteMany({
        where: { expiresAt: { not: null, lt: new Date() } },
      });
    } catch (err) {
      this.logger.warn(`Failed to prune expired packing locks: ${err}`);
    }
  }

  async getQueue(search?: string) {
    await this.pruneExpiredLocks();
    const confirmedStatus = await this.prisma.orderStatus.findUnique({
      where: { name: 'Confirmed' },
    });
    const holdStatus = await this.prisma.orderStatus.findUnique({
      where: { name: 'Packing Hold' },
    });
    if (!confirmedStatus || !holdStatus)
      throw new NotFoundException('Required statuses not found');

    const where: any = {
      trashedAt: null,
      statusId: { in: [confirmedStatus.id, holdStatus.id] },
    };
    if (search) {
      where.OR = [
        { displayId: { contains: search, mode: 'insensitive' } },
        { guestName: { contains: search, mode: 'insensitive' } },
        { guestPhone: { contains: search, mode: 'insensitive' } },
      ];
    }

    // The queue is capped so a single 15s poll can never ship the whole
    // Confirmed+Packing-Hold backlog to every packer kiosk. The cap is NOT a
    // filter: `total` counts everything matching `where`, so the client can tell
    // the packer that more orders exist than are loaded instead of silently
    // stranding the ones past the limit.
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: QUEUE_ORDER_INCLUDE,
        // Oldest-first: packing works the front of the backlog.
        orderBy: { createdAt: 'asc' },
        take: PACKING_QUEUE_PAGE_SIZE,
      }),
      this.prisma.order.count({ where }),
    ]);

    // Canonical photo catalog: compact per-product variant/attribute data used
    // by the shared admin image resolver (lib/product-image.ts) to apply the
    // variant -> color-sibling -> product hierarchy client-side. Deduplicated
    // across the whole queue to keep the payload slim.
    const photoCatalog: Record<
      string,
      {
        images: unknown;
        variants: {
          id: string | null;
          image: string | null;
          images: unknown;
          attributeValues: {
            attributeValue: {
              value: string | null;
              hexCode: string | null;
              attribute: { name: string | null };
            } | null;
          }[];
        }[];
      }
    > = {};

    // The catalog is accumulated across every order in the page, but it is a
    // shared, de-duplicated structure — it is returned ONCE at the top level
    // instead of being attached by reference to each order (which serialized
    // the whole catalog once per order, i.e. O(orders x catalogSize)).
    const mappedOrders = orders.map((o) => {
      for (const i of o.items) {
        this.buildCatalogEntry(
          photoCatalog,
          i.product ?? i.variant?.product ?? null,
          i.variant ?? null,
        );
      }
      return this.mapQueueOrder(o);
    });

    return { orders: mappedOrders, photoCatalog, total };
  }

  /**
   * Adds one product to the shared photo catalog, deduplicated by product id.
   */
  private buildCatalogEntry(
    photoCatalog: Record<string, any>,
    product: any,
    variant: any,
  ) {
    if (!product?.id || photoCatalog[product.id]) return;
    // `product.variants` is only populated on the canonical `item.product`
    // branch; `item.variant.product` is a scalar select. When only the variant
    // itself is available, seed the entry with it so the line can still resolve
    // its own image.
    photoCatalog[product.id] = {
      images: product.images ?? null,
      variants: (product.variants ?? []).map(slimVariant),
    };
    if (!photoCatalog[product.id].variants.length && variant?.id) {
      photoCatalog[product.id].variants.push(slimVariant(variant));
    }
  }

  /** Maps a Prisma order row (see QUEUE_ORDER_INCLUDE) to the queue shape. */
  private mapQueueOrder(o: any) {
    return {
      id: o.id,
      displayId: o.displayId,
      customer: o.customer
        ? { id: o.customer.id, name: o.customer.name, phone: o.customer.phone }
        : o.guestName
          ? { name: o.guestName, phone: o.guestPhone }
          : null,
      items: (o.items ?? []).map((i: any) => {
        const product = i.product ?? i.variant?.product ?? null;
        const variant = i.variant ?? null;
        const variantAttrs = variant?.attributeValues
          ? variant.attributeValues
              .map((av: any) => av.attributeValue?.value)
              .filter(Boolean)
              .join(' / ')
          : '';
        const variantImage =
          resolveImage(variant?.image) || firstOf(variant?.images);
        // Parent product image — used when the variant has no image of its own
        // (e.g. size-only variations) or the variant image is broken.
        const productImage = firstOf(product?.images);
        return {
          id: i.id,
          productId: i.productId ?? product?.id ?? null,
          variantId: i.variantId ?? null,
          productName: product?.name ?? 'Unknown',
          variantName: variantAttrs || '',
          sku: variant?.sku ?? '',
          quantity: i.quantity,
          image: variantImage || productImage,
          fallbackImage: productImage,
        };
      }),
      totalItems: (o.items ?? []).reduce(
        (sum: number, i: any) => sum + i.quantity,
        0,
      ),
      packingLock: o.packingLock
        ? {
            packerId: o.packingLock.packerId,
            packerName: `${o.packingLock.packer.firstName} ${o.packingLock.packer.lastName}`,
            startedAt: o.packingLock.startedAt,
            expiresAt: o.packingLock.expiresAt,
          }
        : null,
      statusName: o.status.name,
      statusColor: o.status.color,
      createdAt: o.createdAt,
    };
  }

  /**
   * Full detail for a single order, in exactly the same shape `getQueue`
   * returns. Used when a packer opens an order by scanning/typing that is
   * legitimately beyond the capped queue page — without it they would get an
   * empty item list.
   */
  async getOrderDetail(orderId: string) {
    const [confirmedStatus, holdStatus] = await Promise.all([
      this.prisma.orderStatus.findUnique({ where: { name: 'Confirmed' } }),
      this.prisma.orderStatus.findUnique({ where: { name: 'Packing Hold' } }),
    ]);
    if (!confirmedStatus || !holdStatus)
      throw new NotFoundException('Required statuses not found');

    const o = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        trashedAt: null,
        statusId: { in: [confirmedStatus.id, holdStatus.id] },
      },
      include: QUEUE_ORDER_INCLUDE,
    });
    if (!o) return null;

    const photoCatalog: Record<string, any> = {};
    for (const i of o.items) {
      this.buildCatalogEntry(
        photoCatalog,
        i.product ?? i.variant?.product ?? null,
        i.variant ?? null,
      );
    }
    return { orders: [this.mapQueueOrder(o)], photoCatalog };
  }

  async openOrder(orderId: string, packerId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, trashedAt: null },
      include: { packingLock: true, status: { select: { name: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (
      order.status.name !== 'Confirmed' &&
      order.status.name !== 'Packing Hold'
    ) {
      throw new BadRequestException(
        'Order is not in Confirmed or Packing Hold status',
      );
    }

    const existingLock = order.packingLock;
    if (existingLock && existingLock.packerId !== packerId) {
      const isExpired =
        existingLock.expiresAt && new Date() > existingLock.expiresAt;
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

  /**
   * Resolves the status ids that packing is allowed to act from. Used both to
   * validate up front and to build the compare-and-set filter.
   */
  private async getPackableStatusIds() {
    const [confirmed, hold] = await Promise.all([
      this.prisma.orderStatus.findUnique({ where: { name: 'Confirmed' } }),
      this.prisma.orderStatus.findUnique({ where: { name: 'Packing Hold' } }),
    ]);
    if (!confirmed || !hold) {
      throw new NotFoundException('Required statuses not found');
    }
    return { confirmed, hold };
  }

  /**
   * Fail-fast pre-check so the caller gets a clean 400 before a transaction is
   * opened. The authoritative, race-free check is `lockAndAssertPackable`,
   * which runs inside the transaction.
   */
  private async assertStillPackable(
    orderId: string,
    allowedStatusIds: string[],
  ) {
    const current = await this.prisma.order.findFirst({
      where: { id: orderId, trashedAt: null },
      select: { statusId: true },
    });
    if (!current) throw new NotFoundException('Order not found');
    if (!allowedStatusIds.includes(current.statusId)) {
      throw new BadRequestException(
        'Order status changed since queue fetch. Please refresh and try again.',
      );
    }
    return current.statusId;
  }

  /**
   * Takes a row-level lock on the order (`SELECT … FOR UPDATE`) and verifies its
   * status is still one packing is allowed to act from.
   *
   * This runs INSIDE the transaction that performs the status change, so the
   * check and the write are one unit of work: a concurrent status change has to
   * wait for this transaction, and any writer that committed first is already
   * visible to us. A plain read-then-write check (which is what this replaced)
   * left a window for a racing admin/packer to change the status in between.
   */
  private async lockAndAssertPackable(
    tx: Prisma.TransactionClient,
    orderId: string,
    allowedStatusIds: string[],
  ) {
    const rows = await tx.$queryRaw<
      { id: string; statusId: string }[]
    >`SELECT id, "statusId" FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new NotFoundException('Order not found');
    if (!allowedStatusIds.includes(row.statusId)) {
      throw new BadRequestException(
        'Order status changed since queue fetch. Please refresh and try again.',
      );
    }
    return row.statusId;
  }

  async markDone(orderId: string, packerId: string, verificationMode: string) {
    const lock = await this.prisma.packingLock.findUnique({
      where: { orderId },
    });
    if (!lock) throw new BadRequestException('Order is not opened for packing');
    if (lock.packerId !== packerId)
      throw new ConflictException('Order is locked by another packer');

    const packedStatus = await this.prisma.orderStatus.findUnique({
      where: { name: 'Packed' },
    });
    if (!packedStatus) throw new NotFoundException('Packed status not found');

    const { confirmed, hold } = await this.getPackableStatusIds();
    const allowedStatusIds = [confirmed.id, hold.id];

    const packer = await this.prisma.userProfile.findUnique({
      where: { id: packerId },
      select: { firstName: true, lastName: true },
    });
    const packerName = packer
      ? `${packer.firstName} ${packer.lastName}`
      : 'System Packer';

    // Fail fast (and with a useful message) before opening a transaction.
    await this.assertStillPackable(orderId, allowedStatusIds);

    // The status change and the lock release must be one unit of work: a crash
    // between them used to leave an already-Packed order holding a lock that
    // blocked every other packer for 30 minutes.
    const note = `Order packed successfully. Verification mode: ${verificationMode}.`;
    await this.prisma.$transaction(async (tx) => {
      await this.lockAndAssertPackable(tx, orderId, allowedStatusIds);
      await this.ordersService.updateStatus(
        orderId,
        { statusId: packedStatus.id, note },
        packerId,
        packerName,
        tx,
      );
      await tx.packingLock.deleteMany({ where: { orderId } });
    });

    return { success: true, orderId };
  }

  async markHold(
    orderId: string,
    packerId: string,
    reason: string,
    notes?: string,
  ) {
    const lock = await this.prisma.packingLock.findUnique({
      where: { orderId },
    });
    if (!lock) throw new BadRequestException('Order is not opened for packing');
    if (lock.packerId !== packerId)
      throw new ConflictException('Order is locked by another packer');

    const holdStatus = await this.prisma.orderStatus.findUnique({
      where: { name: 'Packing Hold' },
    });
    if (!holdStatus)
      throw new NotFoundException('Packing Hold status not found');

    const { confirmed, hold } = await this.getPackableStatusIds();
    const allowedStatusIds = [confirmed.id, hold.id];

    const packer = await this.prisma.userProfile.findUnique({
      where: { id: packerId },
      select: { firstName: true, lastName: true },
    });
    const packerName = packer
      ? `${packer.firstName} ${packer.lastName}`
      : 'System Packer';

    // Symmetric with markDone: without this guard a stale lock could drag an
    // already-Packed order backwards through the flow (Packed → Packing Hold is
    // a legal transition in ORDER_TRANSITIONS).
    await this.assertStillPackable(orderId, allowedStatusIds);

    const note = `Order placed on packing hold. Reason: ${reason}. Notes: ${notes ?? 'N/A'}`;

    // Status change, office notes and lock release are one unit of work — they
    // were previously three independent writes.
    await this.prisma.$transaction(async (tx) => {
      await this.lockAndAssertPackable(tx, orderId, allowedStatusIds);
      await this.ordersService.updateStatus(
        orderId,
        { statusId: holdStatus.id, note },
        packerId,
        packerName,
        tx,
      );
      if (notes) {
        await tx.order.update({
          where: { id: orderId },
          data: { officeNotes: notes },
        });
      }
      await tx.packingLock.deleteMany({ where: { orderId } });
    });

    return { success: true, orderId, reason, notes };
  }

  async releaseLock(orderId: string, packerId: string) {
    const lock = await this.prisma.packingLock.findUnique({
      where: { orderId },
    });
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
    const packedStatus = await this.prisma.orderStatus.findUnique({
      where: { name: 'Packed' },
    });
    const holdStatus = await this.prisma.orderStatus.findUnique({
      where: { name: 'Packing Hold' },
    });
    const confirmedStatus = await this.prisma.orderStatus.findUnique({
      where: { name: 'Confirmed' },
    });
    if (!packedStatus || !holdStatus || !confirmedStatus) {
      throw new NotFoundException('Required order status not found');
    }

    const where = packerId ? { assignedToId: packerId } : {};

    const today = startOfDhakaDay();

    const [packedCount, holdCount, pendingCount] = await Promise.all([
      this.prisma.order.count({
        where: {
          ...where,
          trashedAt: null,
          statusId: packedStatus.id,
          updatedAt: { gte: today },
        },
      }),
      this.prisma.order.count({
        where: {
          ...where,
          trashedAt: null,
          statusId: holdStatus.id,
          updatedAt: { gte: today },
        },
      }),
      // P1-7: `pending` was missing `...where`, so a packer's "my packing" stats
      // showed the company-wide Confirmed backlog.
      this.prisma.order.count({
        where: { ...where, statusId: confirmedStatus.id, trashedAt: null },
      }),
    ]);

    return { packed: packedCount, held: holdCount, pending: pendingCount };
  }

  async getHistory(packerId?: string) {
    const packedStatus = await this.prisma.orderStatus.findUnique({
      where: { name: 'Packed' },
    });
    const holdStatus = await this.prisma.orderStatus.findUnique({
      where: { name: 'Packing Hold' },
    });
    if (!packedStatus || !holdStatus) {
      throw new NotFoundException('Required order status not found');
    }

    const where = packerId ? { assignedToId: packerId } : {};

    const orders = await this.prisma.order.findMany({
      where: {
        ...where,
        trashedAt: null,
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
      packerName: o.assignee
        ? `${o.assignee.firstName} ${o.assignee.lastName}`
        : 'N/A',
      updatedAt: o.updatedAt,
    }));
  }

  async checkOrderStatus(code: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        trashedAt: null,
        OR: [
          { id: code },
          { displayId: { equals: code, mode: 'insensitive' } },
        ],
      },
      include: {
        status: { select: { name: true } },
      },
    });

    if (!order) {
      return { exists: false };
    }

    return {
      exists: true,
      id: order.id,
      displayId: order.displayId,
      status: order.status.name,
    };
  }
}
