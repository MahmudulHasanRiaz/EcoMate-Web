import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ManagedStockMovementType,
  MovementDirection,
  ReferenceEntity,
  Prisma,
} from '@prisma/client';

@Injectable()
export class ManagedStockLedgerService {
  constructor(private prisma: PrismaService) {}

  async record(
    params: {
      productId?: string;
      variantId?: string;
      comboId?: string;
      quantity: number;
      direction: MovementDirection;
      type: ManagedStockMovementType;
      stockBefore?: number;
      stockAfter?: number;
      referenceType?: ReferenceEntity;
      referenceId?: string;
      note?: string;
      reason?: string;
      performedById?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.managedStockLedger.create({
      data: {
        productId: params.productId ?? null,
        variantId: params.variantId ?? null,
        comboId: params.comboId ?? null,
        quantity: Math.abs(params.quantity),
        direction: params.direction,
        type: params.type,
        stockBefore: params.stockBefore ?? null,
        stockAfter: params.stockAfter ?? null,
        referenceType: params.referenceType ?? null,
        referenceId: params.referenceId ?? null,
        note: params.note ?? null,
        reason: params.reason ?? null,
        performedById: params.performedById ?? null,
      },
    });
  }

  async find(params: {
    productId?: string;
    variantId?: string;
    referenceType?: ReferenceEntity;
    referenceId?: string;
    page?: number;
    perPage?: number;
  }) {
    const page = params.page || 1;
    const perPage = params.perPage || 50;
    const where: Prisma.ManagedStockLedgerWhereInput = {};
    if (params.productId) where.productId = params.productId;
    if (params.variantId) where.variantId = params.variantId;
    if (params.referenceType) where.referenceType = params.referenceType;
    if (params.referenceId) where.referenceId = params.referenceId;

    const [data, total] = await Promise.all([
      this.prisma.managedStockLedger.findMany({
        where,
        orderBy: { performedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.managedStockLedger.count({ where }),
    ]);

    const productIds = [
      ...new Set(data.map((l) => l.productId).filter(Boolean)),
    ] as string[];

    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true, sku: true, images: true },
        })
      : [];

    const productMap = new Map(products.map((p) => [p.id, p]));

    const mapped = data.map((l) => {
      const prod = l.productId ? productMap.get(l.productId) : null;
      const prodImages = prod?.images;
      const firstImage = Array.isArray(prodImages) && prodImages.length ? prodImages[0] : null;
      return {
        ...l,
        reference: l.referenceId,
        user: l.performedById,
        productName: prod?.name || '—',
        sku: prod?.sku || '—',
        image: typeof firstImage === 'string' ? firstImage : null,
      };
    });

    return {
      data: mapped,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async hasExistingRestock(referenceId: string): Promise<boolean> {
    const existing = await this.prisma.managedStockLedger.findFirst({
      where: {
        referenceType: ReferenceEntity.ORDER,
        referenceId,
        type: {
          in: [
            ManagedStockMovementType.RETURN,
            ManagedStockMovementType.CANCEL_RELEASE,
          ],
        },
      },
    });
    return !!existing;
  }
}
