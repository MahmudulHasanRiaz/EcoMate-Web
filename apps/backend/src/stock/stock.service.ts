import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ReferenceEntity } from '@prisma/client';

export interface StockOperationParams {
  productId?: string;
  variantId?: string;
  comboId?: string;
  comboSelection?: Record<string, string>;
  quantity: number;
  reference: string;
  performedBy?: string;
  unitCost?: number;
  tx?: Prisma.TransactionClient;
  warehouseId?: string;
  ledgerType?: string;
  binLocationId?: string;
  referenceType?: ReferenceEntity;
  referenceId?: string;
}

interface StockTarget {
  productId: string;
  variantId: string | null;
  qty: number;
}

type StockOp = 'increment' | 'decrement';

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(private readonly prisma: PrismaService) {}

  async isInventoryManagementEnabled(): Promise<boolean> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'inventory_enabled' },
    });
    return setting?.value === 'true';
  }

  private client(tx?: Prisma.TransactionClient) {
    if (tx) return tx;
    return this.prisma;
  }

  private async expandComboItems(
    comboId: string,
    quantity: number,
    comboSelection: Record<string, string> | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<StockTarget[]> {
    const combo = await tx.combo.findUnique({
      where: { id: comboId },
      include: { items: true },
    });
    if (!combo) throw new NotFoundException(`Combo ${comboId} not found`);
    return combo.items.map((ci) => {
      const effectiveVariantId =
        ci.variantId || comboSelection?.[ci.productId] || null;
      return {
        productId: ci.productId,
        variantId: effectiveVariantId,
        qty: ci.quantity * quantity,
      };
    });
  }

  private async lockRows(targets: StockTarget[], tx: Prisma.TransactionClient) {
    const productIds = [...new Set(targets.map((t) => t.productId))].sort();
    const variantIds = [
      ...new Set(targets.filter((t) => t.variantId).map((t) => t.variantId!)),
    ].sort();
    if (productIds.length > 0) {
      const ph = productIds.map((_, i) => `$${i + 1}`).join(', ');
      await tx.$queryRawUnsafe(
        `SELECT id FROM "Product" WHERE id IN (${ph}) FOR UPDATE`,
        ...productIds,
      );
    }
    if (variantIds.length > 0) {
      const vh = variantIds.map((_, i) => `$${i + 1}`).join(', ');
      await tx.$queryRawUnsafe(
        `SELECT id FROM "ProductVariant" WHERE id IN (${vh}) FOR UPDATE`,
        ...variantIds,
      );
    }
  }

  private async resolveTargets(
    params: StockOperationParams,
    tx: Prisma.TransactionClient,
  ): Promise<StockTarget[]> {
    if (params.comboId) {
      return this.expandComboItems(
        params.comboId,
        params.quantity,
        params.comboSelection,
        tx,
      );
    }
    if (params.variantId) {
      const v = await tx.productVariant.findUnique({
        where: { id: params.variantId },
        select: { productId: true },
      });
      if (!v)
        throw new NotFoundException(`Variant ${params.variantId} not found`);
      return [
        {
          productId: v.productId,
          variantId: params.variantId,
          qty: params.quantity,
        },
      ];
    }
    if (params.productId) {
      return [
        { productId: params.productId, variantId: null, qty: params.quantity },
      ];
    }
    throw new BadRequestException('productId, variantId, or comboId required');
  }

  private async applyStockChange(
    targets: StockTarget[],
    field: 'managedStockQuantity' | 'reservedStock',
    op: StockOp,
    tx: Prisma.TransactionClient,
  ) {
    const pIds = [...new Set(targets.map((t) => t.productId))];
    const vIds = [
      ...new Set(targets.filter((t) => t.variantId).map((t) => t.variantId!)),
    ];

    const products = await tx.product.findMany({
      where: { id: { in: pIds } },
      select: {
        id: true,
        type: true,
        manageStock: true,
        availabilityMode: true,
        managedStockQuantity: true,
        reservedStock: true,
      },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const variants =
      vIds.length > 0
        ? await tx.productVariant.findMany({
            where: { id: { in: vIds } },
            select: {
              id: true,
              managedStockQuantity: true,
              reservedStock: true,
              productId: true,
            },
          })
        : [];
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    const adjust = async (
      model: 'product' | 'productVariant',
      id: string,
      f: string,
      qty: number,
    ) => {
      const opStr = op === 'increment' ? 'increment' : 'decrement';
      if (model === 'product') {
        await tx.product.update({
          where: { id },
          data: { [f]: { [opStr]: qty } },
        });
      } else {
        await tx.productVariant.update({
          where: { id },
          data: { [f]: { [opStr]: qty } },
        });
      }
    };

    const isManagedField = (p: { availabilityMode: string | null }) =>
      field !== 'managedStockQuantity' ||
      p.availabilityMode === 'MANAGED_STOCK' ||
      p.availabilityMode === null;

    for (const t of targets) {
      if (t.variantId) {
        const v = variantMap.get(t.variantId);
        if (!v)
          throw new BadRequestException(`Variant ${t.variantId} not found`);
        const p = productMap.get(t.productId);
        if (!isManagedField(p!)) continue;
        const avail =
          field === 'reservedStock'
            ? v.managedStockQuantity - v.reservedStock
            : v.managedStockQuantity;
        if (op === 'decrement' && avail < t.qty) {
          throw new BadRequestException(
            `Insufficient stock variant ${t.variantId}. Available: ${avail}, needed: ${t.qty}.`,
          );
        }
        await adjust('productVariant', t.variantId, field, t.qty);
        // Also update parent product stock if it manages stock
        if (p && p.manageStock && p.type === 'simple') {
          if (op === 'decrement' && Number(p[field]) < t.qty) {
            throw new BadRequestException(
              `Insufficient stock product ${t.productId}. Available: ${Number(p[field])}, needed: ${t.qty}.`,
            );
          }
          await adjust('product', t.productId, field, t.qty);
        }
      } else {
        const p = productMap.get(t.productId);
        if (!p)
          throw new BadRequestException(`Product ${t.productId} not found`);
        if (!isManagedField(p)) continue;
        const avail =
          field === 'reservedStock'
            ? p.managedStockQuantity - p.reservedStock
            : p.managedStockQuantity;
        if (op === 'decrement' && !p.manageStock) continue; // skip non-managed stock
        if (op === 'decrement' && avail < t.qty) {
          throw new BadRequestException(
            `Insufficient stock product ${t.productId}. Available: ${avail}, needed: ${t.qty}.`,
          );
        }
        await adjust('product', t.productId, field, t.qty);
      }
    }
  }

  private async deductCostingLots(
    targets: StockTarget[],
    tx: Prisma.TransactionClient,
  ) {
    for (const t of targets) {
      if (t.variantId) continue;
      let remaining = t.qty;
      while (remaining > 0) {
        const lot = await tx.costingLot.findFirst({
          where: { productId: t.productId, remainingQty: { gt: 0 } },
          orderBy: { receivedAt: 'asc' },
        });
        if (!lot) {
          this.logger.warn(
            `No costing lot for product ${t.productId}, remaining ${remaining}`,
          );
          break;
        }
        const deduct = Math.min(remaining, lot.remainingQty);
        await tx.costingLot.update({
          where: { id: lot.id },
          data: { remainingQty: { decrement: deduct } },
        });
        remaining -= deduct;
      }
    }
  }

  private async logInventory(
    targets: StockTarget[],
    type: string,
    reason: string,
    performedBy: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
    for (const t of targets) {
      await tx.inventoryLog.create({
        data: {
          productId: t.productId,
          variantId: t.variantId,
          quantity:
            type === 'scrap' || type === 'order_fulfilled' ? -t.qty : t.qty,
          type,
          reason,
          performedBy,
        },
      });
    }
  }

  private async logPhysicalInventoryLedger(
    targets: StockTarget[],
    warehouseId: string,
    direction: Prisma.$PhysicalInventoryLedgerPayload['scalars']['direction'],
    type: string,
    reference: string,
    performedBy: string | undefined,
    unitCost: number | undefined,
    tx: Prisma.TransactionClient,
    binLocationId?: string,
    _referenceType?: ReferenceEntity,
    _referenceId?: string,
  ) {
    for (const t of targets) {
      const currentQuantity = await tx.physicalInventory.findFirst({
        where: { productId: t.productId, warehouseId, binLocationId: binLocationId ?? null },
        select: { quantity: true },
      }).then(r => r?.quantity ?? 0);
      const stockAfter = currentQuantity;
      const stockBefore =
        direction === 'IN' ? currentQuantity - t.qty : currentQuantity + t.qty;

      await tx.physicalInventoryLedger.create({
        data: {
          productId: t.productId,
          warehouseId,
          quantity: t.qty,
          direction,
          stockBefore,
          stockAfter,
          type,
          reason: reference,
          performedBy,
          unitCost: unitCost != null ? new Prisma.Decimal(unitCost) : null,
        },
      });
    }
  }

  private async logManagedStockLedger(
    targets: StockTarget[],
    direction: Prisma.$ManagedStockLedgerPayload['scalars']['direction'],
    type: Prisma.$ManagedStockLedgerPayload['scalars']['type'],
    referenceType: Prisma.$ManagedStockLedgerPayload['scalars']['referenceType'],
    referenceId: string | undefined,
    performedBy: string | undefined,
    note: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
    for (const t of targets) {
      let currentStock = 0;
      if (t.variantId) {
        const v = await tx.productVariant.findUnique({
          where: { id: t.variantId },
          select: { managedStockQuantity: true },
        });
        currentStock = v?.managedStockQuantity ?? 0;
      } else {
        const p = await tx.product.findUnique({
          where: { id: t.productId },
          select: { managedStockQuantity: true },
        });
        currentStock = p?.managedStockQuantity ?? 0;
      }

      const stockAfter = currentStock;
      const stockBefore =
        direction === 'IN' ? currentStock - t.qty : currentStock + t.qty;

      await tx.managedStockLedger.create({
        data: {
          productId: t.productId,
          variantId: t.variantId,
          comboId: null,
          quantity: t.qty,
          direction,
          type,
          stockBefore,
          stockAfter,
          referenceType,
          referenceId,
          reason: note,
          performedById: performedBy,
        },
      });
    }
  }

  private async applyPhysicalChange(
    targets: { productId: string; warehouseId: string; qty: number; binLocationId?: string }[],
    op: 'increment' | 'decrement',
    field: 'quantity' | 'reservedQuantity',
    tx: Prisma.TransactionClient,
  ) {
    for (const t of targets) {
      const whereClause: any = {
        productId: t.productId,
        warehouseId: t.warehouseId,
      };
      if (t.binLocationId) {
        whereClause.binLocationId = t.binLocationId;
      } else {
        whereClause.binLocationId = null;
      }

      const existing = await tx.physicalInventory.findFirst({ where: whereClause });
      if (!existing && op === 'decrement') {
        throw new BadRequestException(
          `No physical inventory record for product ${t.productId} in warehouse ${t.warehouseId}${t.binLocationId ? ` bin ${t.binLocationId}` : ''}`,
        );
      }

      if (existing) {
        await tx.physicalInventory.update({
          where: { id: existing.id },
          data: { [field]: { [op]: t.qty } },
        });
      } else {
        await tx.physicalInventory.create({
          data: {
            productId: t.productId,
            warehouseId: t.warehouseId,
            binLocationId: t.binLocationId || null,
            quantity: field === 'quantity' ? (op === 'increment' ? t.qty : 0) : 0,
            reservedQuantity:
              field === 'reservedQuantity' ? (op === 'increment' ? t.qty : 0) : 0,
          },
        });
      }
    }
  }

  private async operatePhysical(
    operation: 'reserve' | 'release' | 'deduct' | 'add',
    params: StockOperationParams,
  ) {
    if (!params.warehouseId) {
      throw new BadRequestException(
        'warehouseId required for physical inventory operations',
      );
    }
    const exec = async (tx: Prisma.TransactionClient) => {
      let targets = await this.resolveTargets(params, tx);
      let effectiveOperation = operation;
      let isNegative = false;

      if (params.quantity < 0) {
        isNegative = true;
        targets = targets.map((t) => ({ ...t, qty: Math.abs(t.qty) }));
        if (operation === 'add') {
          effectiveOperation = 'deduct';
        }
      }

      for (const t of targets) {
        const product = await tx.product.findUnique({
          where: { id: t.productId },
          select: { availabilityMode: true },
        });
        if (product) {
          if (product.availabilityMode === 'ALWAYS_IN_STOCK') {
            throw new BadRequestException(
              `Product is always in stock — no physical adjustments allowed`,
            );
          }
          if (product.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
            throw new BadRequestException(
              `Product is always out of stock — no physical adjustments allowed`,
            );
          }
        }
      }

      const physicalTargets = targets.map((t) => ({
        productId: t.productId,
        warehouseId: params.warehouseId!,
        qty: t.qty,
        binLocationId: params.binLocationId,
      }));

      if (effectiveOperation === 'reserve') {
        await this.applyPhysicalChange(
          physicalTargets,
          'increment',
          'reservedQuantity',
          tx,
        );
      } else if (effectiveOperation === 'release') {
        await this.applyPhysicalChange(
          physicalTargets,
          'decrement',
          'reservedQuantity',
          tx,
        );
      } else if (effectiveOperation === 'deduct') {
        await this.applyPhysicalChange(
          physicalTargets,
          'decrement',
          'quantity',
          tx,
        );
        await this.applyPhysicalChange(
          physicalTargets,
          'decrement',
          'reservedQuantity',
          tx,
        );
        await this.logPhysicalInventoryLedger(
          targets,
          params.warehouseId!,
          'OUT',
          params.ledgerType || (isNegative ? 'PHYSICAL_ADJUSTMENT' : 'DEDUCTION'),
          params.reference,
          params.performedBy,
          params.unitCost,
          tx,
          params.binLocationId,
          params.referenceType,
          params.referenceId,
        );
      } else if (effectiveOperation === 'add') {
        await this.applyPhysicalChange(
          physicalTargets,
          'increment',
          'quantity',
          tx,
        );
        await this.logPhysicalInventoryLedger(
          targets,
          params.warehouseId!,
          'IN',
          params.ledgerType || 'ADD',
          params.reference,
          params.performedBy,
          params.unitCost,
          tx,
          params.binLocationId,
          params.referenceType,
          params.referenceId,
        );
        // Update bin location on variant if provided
        if (params.binLocationId) {
          for (const t of targets) {
            if (t.variantId) {
              await tx.productVariant.update({
                where: { id: t.variantId },
                data: { binLocationId: params.binLocationId },
              });
            }
          }
        }
      }
      return targets;
    };

    if (params.tx) {
      return exec(params.tx);
    }
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(exec, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < MAX_RETRIES
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  async operate(
    operation: 'reserve' | 'release' | 'deduct' | 'add' | 'scrap',
    params: StockOperationParams,
  ) {
    const exec = async (tx: Prisma.TransactionClient) => {
      const targets = await this.resolveTargets(params, tx);
      await this.lockRows(targets, tx);

      if (operation === 'reserve') {
        await this.applyStockChange(targets, 'reservedStock', 'increment', tx);
        await this.logInventory(
          targets,
          'reserve',
          `Reserved for ${params.reference}`,
          params.performedBy,
          tx,
        );
        await this.logManagedStockLedger(
          targets,
          'IN',
          'ADJUSTMENT',
          'ORDER',
          params.reference,
          params.performedBy,
          `Reserved for ${params.reference}`,
          tx,
        );
      } else if (operation === 'release') {
        await this.applyStockChange(targets, 'reservedStock', 'decrement', tx);
        await this.logInventory(
          targets,
          'release',
          `Released for ${params.reference}`,
          params.performedBy,
          tx,
        );
        await this.logManagedStockLedger(
          targets,
          'OUT',
          'CANCEL_RELEASE',
          'ORDER',
          params.reference,
          params.performedBy,
          `Released for ${params.reference}`,
          tx,
        );
      } else if (operation === 'deduct') {
        await this.applyStockChange(
          targets,
          'managedStockQuantity',
          'decrement',
          tx,
        );
        await this.applyStockChange(targets, 'reservedStock', 'decrement', tx);
        await this.deductCostingLots(targets, tx);
        await this.logInventory(
          targets,
          'order_fulfilled',
          `Deducted for ${params.reference}`,
          params.performedBy,
          tx,
        );
        await this.logManagedStockLedger(
          targets,
          'OUT',
          'ORDER_DEDUCTION',
          'ORDER',
          params.reference,
          params.performedBy,
          `Deducted for ${params.reference}`,
          tx,
        );
      } else if (operation === 'add') {
        await this.applyStockChange(
          targets,
          'managedStockQuantity',
          'increment',
          tx,
        );
        await this.logInventory(
          targets,
          params.reference.startsWith('GRN-') ||
            params.reference.startsWith('PO-')
            ? 'purchase_receive'
            : 'manual_adjustment',
          `Added via ${params.reference}`,
          params.performedBy,
          tx,
        );
        await this.logManagedStockLedger(
          targets,
          'IN',
          (params.ledgerType as Prisma.$ManagedStockLedgerPayload['scalars']['type']) || 'MANUAL_ADD',
          'MANUAL',
          params.reference,
          params.performedBy,
          `Added via ${params.reference}`,
          tx,
        );
      } else if (operation === 'scrap') {
        await this.applyStockChange(
          targets,
          'managedStockQuantity',
          'decrement',
          tx,
        );
        await this.logInventory(
          targets,
          'scrap',
          `Scrapped: ${params.reference}`,
          params.performedBy,
          tx,
        );
        await this.logManagedStockLedger(
          targets,
          'OUT',
          (params.ledgerType as Prisma.$ManagedStockLedgerPayload['scalars']['type']) || 'MANUAL_REMOVE',
          'MANUAL',
          params.reference,
          params.performedBy,
          `Scrapped: ${params.reference}`,
          tx,
        );
      }
      return targets;
    };

    if (params.tx) {
      return exec(params.tx);
    }
    return this.prisma.$transaction(exec);
  }

  reserve(params: StockOperationParams) {
    return this.operate('reserve', params);
  }

  release(params: StockOperationParams) {
    return this.operate('release', params);
  }

  deduct(params: StockOperationParams) {
    return this.operate('deduct', params);
  }

  add(params: StockOperationParams) {
    return this.operate('add', params);
  }

  scrap(params: StockOperationParams) {
    return this.operate('scrap', params);
  }

  async getAvailableStock(productId: string, variantId?: string) {
    if (variantId) {
      const v = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { managedStockQuantity: true, reservedStock: true },
      });
      if (!v) throw new NotFoundException(`Variant ${variantId} not found`);
      return {
        stock: v.managedStockQuantity,
        reserved: v.reservedStock,
        available: v.managedStockQuantity - v.reservedStock,
      };
    }
    const p = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { managedStockQuantity: true, reservedStock: true },
    });
    if (!p) throw new NotFoundException(`Product ${productId} not found`);
    return {
      stock: p.managedStockQuantity,
      reserved: p.reservedStock,
      available: p.managedStockQuantity - p.reservedStock,
    };
  }

  async checkPhysicalAvailability(productId: string, warehouseId: string) {
    const records = await this.prisma.physicalInventory.findMany({
      where: { productId, warehouseId },
      select: { quantity: true, reservedQuantity: true },
    });
    if (records.length === 0) {
      return {
        available: false,
        currentStock: 0,
        reserved: 0,
        availableStock: 0,
      };
    }
    const totalQty = records.reduce((sum, r) => sum + r.quantity, 0);
    const totalReserved = records.reduce((sum, r) => sum + r.reservedQuantity, 0);
    const availableStock = totalQty - totalReserved;
    return {
      available: totalQty > 0,
      currentStock: totalQty,
      reserved: totalReserved,
      availableStock,
    };
  }

  reservePhysical(params: StockOperationParams) {
    return this.operatePhysical('reserve', params);
  }

  releasePhysical(params: StockOperationParams) {
    return this.operatePhysical('release', params);
  }

  deductPhysical(params: StockOperationParams) {
    return this.operatePhysical('deduct', params);
  }

  addPhysical(params: StockOperationParams) {
    return this.operatePhysical('add', params);
  }

  /**
   * Claim + allocate physical reservation for an order item.
   * Strategy: parent upsert (atomic) + Serializable transaction with check-before-create.
   * No P2002 possible: parent uses upsert, allocations check existing before create.
   * Retry on serialization conflict.
   */
  async reservePhysicalAllocated(params: {
    orderId: string;
    orderItemId: string;
    productId: string;
    variantId?: string;
    warehouseId: string;
    quantity: number;
    tx?: Prisma.TransactionClient;
  }) {
    // Phase 1: Atomic parent claim via upsert (no P2002 possible)
    const parent = await this.prisma.physicalReservation.upsert({
      where: { orderItemId: params.orderItemId },
      create: {
        orderId: params.orderId,
        orderItemId: params.orderItemId,
        productId: params.productId,
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        quantity: params.quantity,
        status: 'ALLOCATING',
      },
      update: {},
    });

    // Phase 2: Check if already fully allocated (idempotent return)
    const existingAllocations = await this.prisma.physicalReservationAllocation.findMany({
      where: { reservationId: parent.id },
    });
    if (existingAllocations.length > 0) {
      // Parent already has allocations — mark ACTIVE if still ALLOCATING
      if (parent.status === 'ALLOCATING') {
        await this.prisma.physicalReservation.update({
          where: { id: parent.id },
          data: { status: 'ACTIVE' },
        });
      }
      return existingAllocations;
    }

    // Phase 2b: Stuck ALLOCATING recovery
    // If parent is ALLOCATING for > 5 minutes with no allocations, it's abandoned.
    // Release it so this request can re-allocate.
    if (parent.status === 'ALLOCATING') {
      const elapsed = Date.now() - parent.createdAt.getTime();
      const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
      if (elapsed > STUCK_THRESHOLD_MS) {
        this.logger.warn(`Recovering stuck ALLOCATING reservation ${parent.id} (age: ${Math.round(elapsed / 1000)}s)`);
        // Reset parent to ALLOCATING so allocation can proceed
        await this.prisma.physicalReservation.update({
          where: { id: parent.id },
          data: { status: 'ALLOCATING', quantity: params.quantity },
        });
        // Fall through to Phase 3 allocation
      }
    }

    // Phase 3: Allocate bins — Serializable transaction with retry
    // Avoids P2002 entirely: checks existing allocations before each create
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // Re-check allocations inside transaction (concurrent request may have created some)
          const allocs = await tx.physicalReservationAllocation.findMany({
            where: { reservationId: parent.id },
          });
          if (allocs.length > 0) {
            // Another request completed allocation — idempotent return
            await tx.physicalReservation.update({
              where: { id: parent.id },
              data: { status: 'ACTIVE' },
            });
            return allocs;
          }

          const eligible = await tx.physicalInventory.findMany({
            where: {
              productId: params.productId,
              warehouseId: params.warehouseId,
            },
            orderBy: { updatedAt: 'asc' },
          });

          let remaining = params.quantity;
          const newAllocations: any[] = [];

          for (const pi of eligible) {
            if (remaining <= 0) break;
            const available = pi.quantity - pi.reservedQuantity;
            if (available <= 0) continue;

            const allocQty = Math.min(remaining, available);

            // Check if this PI row already has an allocation (from concurrent request)
            const existingForPI = allocs.find((a) => a.physicalInventoryId === pi.id);
            if (existingForPI) {
              remaining -= existingForPI.quantity;
              continue;
            }

            const allocation = await tx.physicalReservationAllocation.create({
              data: {
                reservationId: parent.id,
                physicalInventoryId: pi.id,
                binLocationId: pi.binLocationId,
                quantity: allocQty,
              },
            });
            newAllocations.push(allocation);

            await tx.physicalInventory.update({
              where: { id: pi.id },
              data: { reservedQuantity: { increment: allocQty } },
            });

            remaining -= allocQty;
          }

          if (remaining > 0) {
            throw new BadRequestException(
              `Insufficient physical stock for product ${params.productId}. Requested: ${params.quantity}, allocated: ${params.quantity - remaining}`,
            );
          }

          await tx.physicalReservation.update({
            where: { id: parent.id },
            data: { status: 'ACTIVE' },
          });

          return [...allocs, ...newAllocations];
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: any) {
        // Serialization conflict → retry
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < MAX_RETRIES) {
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Release physical reservations for an order item. Idempotent.
   */
  async releasePhysicalAllocated(params: {
    orderId: string;
    orderItemId: string;
    tx?: Prisma.TransactionClient;
  }) {
    const client = params.tx || this.prisma;

    const parent = await client.physicalReservation.findUnique({
      where: { orderItemId: params.orderItemId },
      include: { allocations: true },
    });
    if (!parent || parent.status === 'RELEASED' || parent.status === 'CONSUMED') return;

    for (const alloc of parent.allocations) {
      await client.physicalInventory.update({
        where: { id: alloc.physicalInventoryId },
        data: { reservedQuantity: { decrement: alloc.quantity } },
      });
    }

    await client.physicalReservation.update({
      where: { id: parent.id },
      data: { status: 'RELEASED' },
    });
  }

  /**
   * Fulfill physical reservation at HANDED_OVER: deduct quantity, consume FIFO, mark CONSUMED.
   * Idempotent: CONSUMED parent is skipped.
   */
  async fulfillPhysicalReservation(params: {
    orderId: string;
    orderItemId: string;
    quantity: number;
    reference: string;
    performedBy?: string;
    tx?: Prisma.TransactionClient;
  }) {
    const client = params.tx || this.prisma;

    const parent = await client.physicalReservation.findUnique({
      where: { orderItemId: params.orderItemId },
      include: { allocations: true },
    });
    if (!parent || parent.status === 'CONSUMED') return;

    // Atomic claim: ACTIVE → CONSUMED (conditional update within existing transaction)
    const [claimed] = await client.$transaction([
      client.physicalReservation.updateMany({
        where: { id: parent.id, status: 'ACTIVE' },
        data: { status: 'CONSUMED' },
      }),
    ]);
    if (claimed.count === 0) return; // Already consumed

    let remaining = params.quantity;

    for (const alloc of parent.allocations) {
      if (remaining <= 0) break;

      const deductQty = Math.min(remaining, alloc.quantity);

      // Decrement quantity on PI row
      await client.physicalInventory.update({
        where: { id: alloc.physicalInventoryId },
        data: {
          quantity: { decrement: deductQty },
          reservedQuantity: { decrement: deductQty },
        },
      });

      // Consume FIFO CostingLots
      let lotRemaining = deductQty;
      while (lotRemaining > 0) {
        const lot = await client.costingLot.findFirst({
          where: { productId: parent.productId, remainingQty: { gt: 0 } },
          orderBy: { receivedAt: 'asc' },
        });
        if (!lot) {
          this.logger.warn(`No costing lot for product ${parent.productId}, remaining ${lotRemaining}`);
          break;
        }
        const lotDeduct = Math.min(lotRemaining, lot.remainingQty);
        await client.costingLot.update({
          where: { id: lot.id },
          data: { remainingQty: { decrement: lotDeduct } },
        });
        lotRemaining -= lotDeduct;
      }

      // Write ledger entry
      const pi = await client.physicalInventory.findUnique({
        where: { id: alloc.physicalInventoryId },
        select: { quantity: true },
      });
      await client.physicalInventoryLedger.create({
        data: {
          productId: parent.productId,
          warehouseId: parent.warehouseId,
          quantity: deductQty,
          direction: 'OUT',
          stockBefore: (pi?.quantity ?? 0) + deductQty,
          stockAfter: pi?.quantity ?? 0,
          type: 'DEDUCTION',
          reason: params.reference,
          performedBy: params.performedBy,
        },
      });

      remaining -= deductQty;
    }
  }

  async hasExistingPhysicalReservation(orderId: string, orderItemId?: string): Promise<boolean> {
    const where: any = { orderId, status: { in: ['ACTIVE', 'CONSUMED'] } };
    if (orderItemId) where.orderItemId = orderItemId;
    const existing = await this.prisma.physicalReservation.findFirst({ where });
    return !!existing;
  }

  async hasExistingPhysicalRelease(referenceId: string): Promise<boolean> {
    // Check via PhysicalReservation instead of ledger (ledger fields removed)
    const existing = await this.prisma.physicalReservation.findFirst({
      where: {
        orderId: referenceId,
        status: { in: ['RELEASED', 'CONSUMED'] },
      },
    });
    return !!existing;
  }

  async createCostingLotForAdjustment(params: {
    productId: string;
    variantId?: string;
    quantity: number;
    unitCost: number;
    reference: string;
  }) {
    const lotNumber = `ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await this.prisma.costingLot.create({
      data: {
        productId: params.productId,
        variantId: params.variantId,
        lotNumber,
        unitCost: new Prisma.Decimal(params.unitCost),
        totalCost: new Prisma.Decimal(params.unitCost * params.quantity),
        quantity: params.quantity,
        remainingQty: params.quantity,
        receivedAt: new Date(),
      },
    });
  }

  async deductCostingLotsForAdjustment(params: {
    productId: string;
    quantity: number;
  }) {
    let remaining = params.quantity;
    while (remaining > 0) {
      const lot = await this.prisma.costingLot.findFirst({
        where: { productId: params.productId, remainingQty: { gt: 0 } },
        orderBy: { receivedAt: 'asc' },
      });
      if (!lot) {
        this.logger.warn(
          `No costing lot for product ${params.productId}, remaining ${remaining} (adjustment deduction)`,
        );
        break;
      }
      const deduct = Math.min(remaining, lot.remainingQty);
      await this.prisma.costingLot.update({
        where: { id: lot.id },
        data: { remainingQty: { decrement: deduct } },
      });
      remaining -= deduct;
    }
  }

  async listPhysical(productId?: string, warehouseId?: string, binLocationId?: string) {
    const where: any = {};
    if (productId) where.productId = productId;
    if (warehouseId) where.warehouseId = warehouseId;
    if (binLocationId) {
      where.binLocationId = binLocationId;
    } else if (binLocationId === '') {
      where.binLocationId = null;
    }
    return this.prisma.physicalInventory.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true, images: true, lowStockQty: true } },
        warehouse: true,
        binLocation: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listReservations(warehouseId?: string, productId?: string) {
    const where: any = { reservedQuantity: { gt: 0 } };
    if (warehouseId) where.warehouseId = warehouseId;
    if (productId) where.productId = productId;
    return this.prisma.physicalInventory.findMany({
      where,
      include: { product: { select: { id: true, name: true, sku: true, images: true } }, warehouse: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getPhysicalRecord(id: string) {
    return this.prisma.physicalInventory.findUnique({
      where: { id },
      include: { product: { select: { id: true, name: true, sku: true, images: true } }, warehouse: true },
    });
  }

  async getTotalValuation() {
    const products = await this.prisma.product.findMany({
      where: { availabilityMode: 'MANAGED_STOCK' },
      select: {
        id: true,
        name: true,
        managedStockQuantity: true,
        basePrice: true,
        salePrice: true,
      },
    });
    const variants = await this.prisma.productVariant.findMany({
      where: { product: { availabilityMode: 'MANAGED_STOCK' } },
      select: {
        id: true,
        productId: true,
        managedStockQuantity: true,
        price: true,
        sku: true,
      },
    });

    let totalValue = 0;
    let totalStock = 0;
    const items: any[] = [];
    const productPriceMap = new Map(
      products.map((p) => [p.id, Number(p.salePrice || p.basePrice)]),
    );

    for (const v of variants) {
      const price = Number(v.price || productPriceMap.get(v.productId) || 0);
      totalValue += price * v.managedStockQuantity;
      totalStock += v.managedStockQuantity;
      items.push({
        id: v.id,
        type: 'variant',
        sku: v.sku,
        stock: v.managedStockQuantity,
        unitPrice: price,
        totalValue: price * v.managedStockQuantity,
      });
    }
    for (const p of products) {
      const vCount = variants.filter((v) => v.productId === p.id).length;
      if (vCount === 0) {
        const price = productPriceMap.get(p.id) || 0;
        totalValue += price * p.managedStockQuantity;
        totalStock += p.managedStockQuantity;
        items.push({
          id: p.id,
          type: 'product',
          name: p.name,
          stock: p.managedStockQuantity,
          unitPrice: price,
          totalValue: price * p.managedStockQuantity,
        });
      }
    }
    return { items, totalValue, totalStock, count: items.length };
  }
}
