import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { StockRouterService } from '../stock/stock-router.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { CreateGrnDto } from './dto/create-grn.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { ShortClosePurchaseDto } from './dto/short-close-purchase.dto';
import { CancelPurchaseDto } from './dto/cancel-purchase.dto';
import { PurchaseStatus, Prisma } from '@prisma/client';

@Injectable()
export class PurchasesService {
  constructor(
    private prisma: PrismaService,
    private stockService: StockService,
    private stockRouter: StockRouterService,
  ) {}

  private async recordEvent(
    tx: Prisma.TransactionClient,
    purchaseId: string,
    type: string,
    message: string,
    data?: Record<string, unknown>,
    performedBy?: string,
  ) {
    await tx.purchaseEvent.create({
      data: {
        purchaseId,
        type,
        message,
        data: (data ?? {}) as Prisma.InputJsonValue,
        performedBy: performedBy ?? null,
      },
    });
  }

  private async generateNumber(
    prefix: string,
    model: 'purchase' | 'goodsReceiptNote' | 'costingLot',
    field: 'referenceNo' | 'grnNumber' | 'lotNumber',
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const db = tx || this.prisma;
    // PO/GRN/LOT numbers carry the Dhaka business date, not the server TZ.
    const now = new Date(Date.now() + 6 * 60 * 60 * 1000);
    const yy = String(now.getUTCFullYear()).slice(2);
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const datePrefix = `${prefix}-${yy}${mm}${dd}-`;

    // Atomic counter (upsert+increment in one statement): concurrent creates
    // can never read the same "last" row and collide on the unique field.
    // The legacy findFirst-based path is kept only when no tx is available.
    if (tx) {
      const counter = await tx.purchaseCounter.upsert({
        where: { date: `${yy}${mm}${dd}` },
        create: { date: `${yy}${mm}${dd}`, seq: 1 },
        update: { seq: { increment: 1 } },
      });
      return `${datePrefix}${String(counter.seq).padStart(4, '0')}`;
    }

    const modelMap = {
      purchase: db.purchase,
      goodsReceiptNote: db.goodsReceiptNote,
      costingLot: db.costingLot,
    } as const;

    const last = await (modelMap[model] as any).findFirst({
      where: { [field]: { startsWith: datePrefix } },
      orderBy: { [field]: 'desc' },
      select: { [field]: true },
    });

    let seq = 1;
    if (last) {
      const parts = last[field].split('-');
      seq = parseInt(parts[parts.length - 1], 10) + 1;
    }

    return `${datePrefix}${String(seq).padStart(4, '0')}`;
  }

  private async generateReferenceNo(
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    return this.generateNumber('PO', 'purchase', 'referenceNo', tx);
  }

  private async generateGrnNumber(
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    return this.generateNumber('GRN', 'goodsReceiptNote', 'grnNumber', tx);
  }

  private async generateLotNumber(
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    return this.generateNumber('LOT', 'costingLot', 'lotNumber', tx);
  }

  private async validateSupplier(
    supplierId: string,
    tx: Prisma.TransactionClient,
  ) {
    const supplier = await tx.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) {
      throw new NotFoundException(`Supplier with ID ${supplierId} not found`);
    }
  }

  async create(dto: CreatePurchaseDto) {
    const vendorRef = dto.referenceNo || '';
    const notesWithRef = vendorRef
      ? `Vendor Ref: ${vendorRef}\n${dto.notes || ''}`
      : dto.notes || '';

    return this.prisma.$transaction(async (tx) => {
      await this.validateSupplier(dto.supplierId, tx);

      if (!dto.items || dto.items.length === 0) {
        throw new BadRequestException('At least one item is required');
      }

      // Every line must point at a real product, and a variable product can
      // only be bought through one of its variants — a product-level line on
      // a variable product would post stock to the wrong level (F2).
      for (const item of dto.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { id: true, type: true },
        });
        if (!product) {
          throw new BadRequestException(
            `Product ${item.productId} not found`,
          );
        }
        if (item.variantId) {
          const variant = await tx.productVariant.findUnique({
            where: { id: item.variantId },
            select: { id: true, productId: true },
          });
          if (!variant || variant.productId !== item.productId) {
            throw new BadRequestException(
              `Variant ${item.variantId} does not belong to product ${item.productId}`,
            );
          }
        } else if (product.type === 'variable') {
          throw new BadRequestException(
            `Product ${item.productId} is variable — select a variant`,
          );
        }
      }

      const poNumber = await this.generateReferenceNo(tx);

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

      const created = await tx.purchase.create({
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

      await this.recordEvent(
        tx,
        created.id,
        'created',
        `Purchase order ${poNumber} created (${dto.items.length} item(s), ৳${subtotal})`,
        { items: dto.items.length, subtotal },
      );

      return created;
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
          items: {
            include: {
              product: { select: { id: true, name: true, images: true, sku: true } },
              variant: {
                include: {
                  attributeValues: { include: { attributeValue: true } },
                },
              },
            },
          },
          grns: { select: { id: true } },
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
          orderBy: { createdAt: 'desc' },
        },
        events: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
      },
    });

    if (!purchase) {
      throw new NotFoundException(`Purchase with ID ${id} not found`);
    }

    return { ...purchase, summary: this.buildSummary(purchase) };
  }

  async update(id: string, dto: UpdatePurchaseDto) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!purchase) {
      throw new NotFoundException(`Purchase with ID ${id} not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};

      const grnCount = await tx.goodsReceiptNote.count({
        where: { purchaseId: id },
      });
      // Once goods moved, the commercial terms are history: costs were posted
      // against this supplier on these dates. Only free-text notes stay open.
      const locked = grnCount > 0;
      if (locked && (
        dto.supplierId !== undefined ||
        dto.orderDate !== undefined ||
        dto.expectedDate !== undefined ||
        dto.items !== undefined
      )) {
        throw new ConflictException(
          'Only notes can be updated after goods have been received',
        );
      }
      if (purchase.status === PurchaseStatus.cancelled && (
        dto.supplierId !== undefined ||
        dto.orderDate !== undefined ||
        dto.expectedDate !== undefined ||
        dto.items !== undefined
      )) {
        throw new ConflictException('Cancelled purchases are read-only except notes');
      }

      if (dto.supplierId !== undefined) {
        await this.validateSupplier(dto.supplierId, tx);
        data.supplierId = dto.supplierId;
      }
      if (dto.orderDate !== undefined) data.orderDate = new Date(dto.orderDate);
      if (dto.expectedDate !== undefined)
        data.expectedDate = new Date(dto.expectedDate);
      if (dto.notes !== undefined) data.notes = dto.notes;

      if (dto.items) {
        if (dto.items.length === 0) {
          throw new BadRequestException('At least one item is required');
        }
        for (const item of dto.items) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { id: true, type: true },
          });
          if (!product) {
            throw new BadRequestException(
              `Product ${item.productId} not found`,
            );
          }
          if (item.variantId) {
            const variant = await tx.productVariant.findUnique({
              where: { id: item.variantId },
              select: { id: true, productId: true },
            });
            if (!variant || variant.productId !== item.productId) {
              throw new BadRequestException(
                `Variant ${item.variantId} does not belong to product ${item.productId}`,
              );
            }
          } else if (product.type === 'variable') {
            throw new BadRequestException(
              `Product ${item.productId} is variable — select a variant`,
            );
          }
        }

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
        // Replacement items start with zero received/short-closed; a stale
        // partially_received (from a pre-edit short-close) would be a lie.
        data.status = PurchaseStatus.ordered;
      }

      const updated = await tx.purchase.update({
        where: { id },
        data,
        include: {
          supplier: true,
          items: true,
          grns: true,
        },
      });
      await this.recordEvent(tx, id, 'updated', 'Purchase order updated');
      return updated;
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

    const grnCount = await this.prisma.goodsReceiptNote.count({
      where: { purchaseId: id },
    });
    if (grnCount > 0) {
      throw new ConflictException(
        'Cannot delete purchase with existing GRNs. Cancel it instead.',
      );
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

    return this.prisma.$transaction(async (tx) => {
      // Receiving warehouses (header + per-line overrides) must all exist.
      const warehouseIds = Array.from(
        new Set(
          [dto.warehouseId, ...dto.items.map((i) => i.lineWarehouseId).filter(Boolean)] as string[],
        ),
      );
      for (const wid of warehouseIds) {
        const wh = await tx.warehouse.findUnique({
          where: { id: wid },
          select: { id: true },
        });
        if (!wh) {
          throw new BadRequestException(`Warehouse ${wid} not found`);
        }
      }

      const itemIds = dto.items.map((i) => i.purchaseItemId);
      const purchaseItems = await tx.purchaseItem.findMany({
        where: { id: { in: itemIds }, purchaseId },
      });

      const piMap = new Map(purchaseItems.map((pi) => [pi.id, pi]));

      // Cumulative disposition across previous GRNs for the touched lines.
      const priorLines = await tx.goodsReceiptNoteItem.findMany({
        where: { purchaseItemId: { in: itemIds } },
        select: { purchaseItemId: true, receivedQty: true, acceptedQty: true, rejectedQty: true },
      });
      const prior = new Map<string, { received: number; accepted: number; rejected: number }>();
      for (const l of priorLines) {
        if (!l.purchaseItemId) continue;
        const e = prior.get(l.purchaseItemId) || { received: 0, accepted: 0, rejected: 0 };
        e.received += l.receivedQty;
        e.accepted += l.acceptedQty;
        e.rejected += l.rejectedQty;
        prior.set(l.purchaseItemId, e);
      }

      for (const d of dto.items) {
        if (d.receivedQty < 0) {
          throw new BadRequestException(
            `receivedQty must be >= 0 for item ${d.purchaseItemId}`,
          );
        }
        if (d.acceptedQty < 0) {
          throw new BadRequestException(
            `acceptedQty must be >= 0 for item ${d.purchaseItemId}`,
          );
        }
        if (d.rejectedQty < 0) {
          throw new BadRequestException(
            `rejectedQty must be >= 0 for item ${d.purchaseItemId}`,
          );
        }
        if (d.acceptedQty + d.rejectedQty > d.receivedQty) {
          throw new BadRequestException(
            `acceptedQty (${d.acceptedQty}) + rejectedQty (${d.rejectedQty}) exceeds receivedQty (${d.receivedQty}) for item ${d.purchaseItemId}`,
          );
        }

        const pi = piMap.get(d.purchaseItemId);
        if (!pi) {
          throw new NotFoundException(
            `Purchase item ${d.purchaseItemId} not found in purchase`,
          );
        }

        // Identity is authoritative from the PO line — a client-supplied
        // product/variant that disagrees is rejected, never trusted.
        if (d.productId && pi.productId && d.productId !== pi.productId) {
          throw new BadRequestException(
            `productId ${d.productId} does not match purchase item ${d.purchaseItemId}`,
          );
        }
        const effVariantId = pi.variantId || d.variantId || null;
        if (d.variantId && pi.variantId && d.variantId !== pi.variantId) {
          throw new BadRequestException(
            `variantId ${d.variantId} does not match purchase item ${d.purchaseItemId}`,
          );
        }
        if (!pi.productId && !d.productId) {
          throw new BadRequestException(
            `productId is required for item ${d.purchaseItemId}`,
          );
        }

        const prev = prior.get(d.purchaseItemId) || { received: 0, accepted: 0, rejected: 0 };
        const remaining = pi.quantity - prev.received - (pi.shortClosedQty || 0);
        if (d.receivedQty > remaining) {
          throw new ConflictException(
            `Received qty (${prev.received + d.receivedQty}) exceeds remaining qty (${remaining + prev.received} ordered, ${prev.received} already received, ${pi.shortClosedQty || 0} short-closed) for item ${d.purchaseItemId}`,
          );
        }
        // Note: no separate accepted-cumulative guard — acceptedQty can never
        // exceed receivedQty per line, and cumulative received is capped
        // above, so cumulative accepted is capped transitively.

        // A variant supplied by the client (PO line has none) must belong to
        // the product being received — never trust it blind, or stock lands
        // on a foreign product's variant.
        const effProductId = pi.productId || d.productId!;
        if (d.variantId && d.variantId !== pi.variantId) {
          const variant = await tx.productVariant.findUnique({
            where: { id: d.variantId },
            select: { id: true, productId: true },
          });
          if (!variant || variant.productId !== effProductId) {
            throw new BadRequestException(
              `Variant ${d.variantId} does not belong to product ${effProductId}`,
            );
          }
        }

        (d as any).__eff = {
          productId: effProductId,
          variantId: effVariantId,
          lineWarehouseId: d.lineWarehouseId || dto.warehouseId,
          responsibility: d.damageResponsibility || 'supplier',
          freeOfCharge: d.freeOfCharge === true,
        };
      }

      const grnNumber = await this.generateGrnNumber(tx);

      const grn = await tx.goodsReceiptNote.create({
        data: {
          grnNumber,
          purchaseId,
          warehouseId: dto.warehouseId,
          receivedBy: userId,
          status: 'received',
          notes: dto.notes,
          items: {
            create: dto.items.map((d) => {
              const pi = piMap.get(d.purchaseItemId)!;
              const eff = (d as any).__eff;
              const unitBase = Number(pi.totalBill) / Number(pi.quantity);
              // Effective line unit: free replacements cost 0; company-borne
              // damage spreads the line's full cost over the accepted units;
              // supplier-borne damage never inflates inventory value.
              let lineUnit = unitBase;
              if (eff.freeOfCharge) {
                lineUnit = 0;
              } else if (
                d.rejectedQty > 0 &&
                eff.responsibility === 'company' &&
                d.acceptedQty > 0
              ) {
                lineUnit = (unitBase * (d.acceptedQty + d.rejectedQty)) / d.acceptedQty;
              }
              const lineUnitDec = new Prisma.Decimal(lineUnit);
              return {
                purchaseItemId: d.purchaseItemId,
                productId: eff.productId,
                variantId: eff.variantId,
                expectedQty: pi.quantity,
                receivedQty: d.receivedQty,
                acceptedQty: d.acceptedQty,
                rejectedQty: d.rejectedQty,
                unitCost: lineUnitDec,
                totalCost: lineUnitDec.mul(d.acceptedQty),
                damageResponsibility: eff.responsibility,
                freeOfCharge: eff.freeOfCharge,
                lineWarehouseId: eff.lineWarehouseId,
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

      const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
      const productIds = Array.from(
        new Set(dto.items.map((d) => (d as any).__eff.productId)),
      );
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, availabilityMode: true },
      });
      const modeMap = new Map(products.map((p) => [p.id, p.availabilityMode]));

      let supplierIncrement = new Prisma.Decimal(0);

      for (const created of grn.items) {
        const d = dto.items.find((i) => i.purchaseItemId === created.purchaseItemId)!;
        const eff = (d as any).__eff;
        const lineValue = Number(created.totalCost);
        supplierIncrement = supplierIncrement.add(lineValue);

        if (created.acceptedQty <= 0) continue;

        const lotNumber = await this.generateLotNumber(tx);
        const lotUnit = Number(created.unitCost);

        await tx.costingLot.create({
          data: {
            purchaseId,
            grnId: grn.id,
            productId: eff.productId,
            variantId: eff.variantId,
            warehouseId: eff.lineWarehouseId,
            lotNumber,
            unitCost: new Prisma.Decimal(lotUnit),
            totalCost: new Prisma.Decimal(lineValue),
            quantity: created.acceptedQty,
            remainingQty: created.acceptedQty,
          },
        });

        // Stock legs follow the router: managed and/or physical depending on
        // the product's availability mode and the IM switch. GRN receipts must
        // replenish the SAME model sales read, or bought goods stay unsellable.
        const decision = this.stockRouter.resolve(
          modeMap.get(eff.productId) || 'MANAGED_STOCK',
          'add',
          imEnabled,
        );
        if (decision.ms !== 'skip') {
          await this.stockService.operate(
            'add',
            {
              productId: eff.productId,
              variantId: eff.variantId,
              quantity: created.acceptedQty,
              reference: `GRN-${grnNumber}`,
              referenceType: 'PURCHASE' as any,
              referenceId: purchaseId,
              ledgerType: 'PURCHASE_RECEIVE',
              performedBy: userId,
              tx,
            } as any,
          );
        }
        if (decision.pi !== 'skip') {
          await this.stockService.addPhysical({
            productId: eff.productId,
            variantId: eff.variantId,
            quantity: created.acceptedQty,
            warehouseId: eff.lineWarehouseId,
            reference: `GRN-${grnNumber}`,
            unitCost: lotUnit,
            performedBy: userId,
            tx,
          });
        }
      }

      await tx.supplier.update({
        where: { id: purchase.supplierId },
        data: {
          totalPurchases: { increment: supplierIncrement },
          balance: { increment: supplierIncrement },
        },
      });

      // Disposition gate: recomputeStatus reads EVERY GRN line of EVERY item
      // (not just this GRN's touched lines), so an item completed in an
      // earlier GRN counts as done. Done = accepted + rejected + short-closed
      // >= ordered; raw "received" alone never completes an item (an
      // all-rejected line is damage, not stock).
      const newStatus = await this.recomputeStatus(tx, purchaseId, purchase.status);

      await tx.purchase.update({
        where: { id: purchaseId },
        data: { status: newStatus },
      });

      await this.recordEvent(
        tx,
        purchaseId,
        'grn',
        `GRN ${grnNumber} received (${dto.items.length} line(s), accepted value ৳${supplierIncrement.toFixed(2)})`,
        {
          grnNumber,
          lines: dto.items.map((d) => ({
            purchaseItemId: d.purchaseItemId,
            receivedQty: d.receivedQty,
            acceptedQty: d.acceptedQty,
            rejectedQty: d.rejectedQty,
            damageResponsibility: (d as any).__eff.responsibility,
            freeOfCharge: (d as any).__eff.freeOfCharge,
            warehouseId: (d as any).__eff.lineWarehouseId,
          })),
          status: newStatus,
        },
        userId,
      );

      return grn;
    });
  }

  async shortClose(purchaseId: string, dto: ShortClosePurchaseDto, userId?: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
      select: { id: true, status: true, referenceNo: true },
    });
    if (!purchase) {
      throw new NotFoundException(`Purchase with ID ${purchaseId} not found`);
    }
    if (purchase.status === PurchaseStatus.cancelled) {
      throw new ConflictException('Purchase is cancelled');
    }
    if (purchase.status === PurchaseStatus.received) {
      throw new ConflictException('Purchase is already fully received');
    }

    return this.prisma.$transaction(async (tx) => {
      const itemIds = dto.items.map((i) => i.purchaseItemId);
      const purchaseItems = await tx.purchaseItem.findMany({
        where: { id: { in: itemIds }, purchaseId },
      });
      const piMap = new Map(purchaseItems.map((pi) => [pi.id, pi]));

      const priorLines = await tx.goodsReceiptNoteItem.findMany({
        where: { purchaseItemId: { in: itemIds } },
        select: { purchaseItemId: true, receivedQty: true },
      });
      const receivedByItem = new Map<string, number>();
      for (const l of priorLines) {
        if (!l.purchaseItemId) continue;
        receivedByItem.set(
          l.purchaseItemId,
          (receivedByItem.get(l.purchaseItemId) || 0) + l.receivedQty,
        );
      }

      for (const d of dto.items) {
        const pi = piMap.get(d.purchaseItemId);
        if (!pi) {
          throw new NotFoundException(
            `Purchase item ${d.purchaseItemId} not found in purchase`,
          );
        }
        if (!d.reason || !d.reason.trim()) {
          throw new BadRequestException(
            `A reason is required to short-close item ${d.purchaseItemId}`,
          );
        }
        const remaining =
          pi.quantity - (receivedByItem.get(d.purchaseItemId) || 0) - (pi.shortClosedQty || 0);
        if (d.qty > remaining) {
          throw new ConflictException(
            `Short-close qty (${d.qty}) exceeds remaining qty (${remaining}) for item ${d.purchaseItemId}`,
          );
        }
        await tx.purchaseItem.update({
          where: { id: d.purchaseItemId },
          data: {
            shortClosedQty: { increment: d.qty },
            shortCloseReason: d.reason.trim(),
          },
        });
      }

      const newStatus = await this.recomputeStatus(tx, purchaseId, purchase.status);
      await tx.purchase.update({
        where: { id: purchaseId },
        data: { status: newStatus },
      });

      await this.recordEvent(
        tx,
        purchaseId,
        'short_closed',
        `Short-closed ${dto.items.reduce((s, i) => s + i.qty, 0)} unit(s) across ${dto.items.length} line(s)`,
        { lines: dto.items, status: newStatus },
        userId,
      );

      return this.findOneTx(tx, purchaseId);
    });
  }

  async cancel(purchaseId: string, dto: CancelPurchaseDto, userId?: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: { items: true },
    });
    if (!purchase) {
      throw new NotFoundException(`Purchase with ID ${purchaseId} not found`);
    }
    if (purchase.status === PurchaseStatus.cancelled) {
      throw new ConflictException('Purchase is already cancelled');
    }
    if (purchase.status === PurchaseStatus.received) {
      throw new ConflictException(
        'Purchase is fully received — cancel is no longer possible',
      );
    }
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('A reason is required to cancel a purchase');
    }

    return this.prisma.$transaction(async (tx) => {
      // Cancel short-closes every outstanding remainder so no quantity is
      // left silently pending; already-received stock stays in inventory.
      const itemIds = purchase.items.map((i) => i.id);
      const priorLines = await tx.goodsReceiptNoteItem.findMany({
        where: { purchaseItemId: { in: itemIds } },
        select: { purchaseItemId: true, receivedQty: true },
      });
      const receivedByItem = new Map<string, number>();
      for (const l of priorLines) {
        if (!l.purchaseItemId) continue;
        receivedByItem.set(
          l.purchaseItemId,
          (receivedByItem.get(l.purchaseItemId) || 0) + l.receivedQty,
        );
      }

      let closedQty = 0;
      for (const pi of purchase.items) {
        const remaining =
          pi.quantity - (receivedByItem.get(pi.id) || 0) - (pi.shortClosedQty || 0);
        if (remaining > 0) {
          await tx.purchaseItem.update({
            where: { id: pi.id },
            data: {
              shortClosedQty: { increment: remaining },
              shortCloseReason: `PO cancelled: ${dto.reason.trim()}`,
            },
          });
          closedQty += remaining;
        }
      }

      await tx.purchase.update({
        where: { id: purchaseId },
        data: { status: PurchaseStatus.cancelled },
      });

      await this.recordEvent(
        tx,
        purchaseId,
        'cancelled',
        `Purchase cancelled (${closedQty} outstanding unit(s) short-closed): ${dto.reason.trim()}`,
        { closedQty, reason: dto.reason.trim() },
        userId,
      );

      return this.findOneTx(tx, purchaseId);
    });
  }

  /** Disposition gate shared by GRN and short-close. */
  private async recomputeStatus(
    tx: Prisma.TransactionClient,
    purchaseId: string,
    fallback: PurchaseStatus,
  ): Promise<PurchaseStatus> {
    const items = await tx.purchaseItem.findMany({ where: { purchaseId } });
    if (items.length === 0) return fallback;
    const lines = await tx.goodsReceiptNoteItem.findMany({
      where: { purchaseItemId: { in: items.map((i) => i.id) } },
      select: { purchaseItemId: true, receivedQty: true, acceptedQty: true, rejectedQty: true },
    });
    const byItem = new Map<string, { received: number; accepted: number; rejected: number }>();
    for (const l of lines) {
      if (!l.purchaseItemId) continue;
      const e = byItem.get(l.purchaseItemId) || { received: 0, accepted: 0, rejected: 0 };
      e.received += l.receivedQty;
      e.accepted += l.acceptedQty;
      e.rejected += l.rejectedQty;
      byItem.set(l.purchaseItemId, e);
    }
    const done = (i: any) => {
      const p = byItem.get(i.id) || { received: 0, accepted: 0, rejected: 0 };
      return p.accepted + p.rejected + (i.shortClosedQty || 0) >= i.quantity;
    };
    if (items.every(done)) return PurchaseStatus.received;
    if (items.some((i) => {
      const p = byItem.get(i.id) || { received: 0, accepted: 0, rejected: 0 };
      return p.received > 0 || (i.shortClosedQty || 0) > 0;
    })) return PurchaseStatus.partially_received;
    return fallback;
  }

  private async findOneTx(tx: Prisma.TransactionClient, id: string) {
    const purchase = await tx.purchase.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: { include: { product: true, variant: true } },
        costingLots: true,
        grns: { include: { items: true }, orderBy: { createdAt: 'desc' } },
        events: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!purchase) {
      throw new NotFoundException(`Purchase with ID ${id} not found`);
    }
    return { ...purchase, summary: this.buildSummary(purchase as any) };
  }

  /**
   * Per-item and PO-level disposition summary: ordered → received →
   * accepted / rejected / short-closed → remaining. The financial side
   * follows the same split (accepted value from GRN lines, short value from
   * PO unit cost, supplier-borne damage excluded from inventory value).
   */
  private buildSummary(purchase: any) {
    const linesByItem = new Map<string, any[]>();
    for (const g of purchase.grns || []) {
      for (const l of g.items || []) {
        if (!l.purchaseItemId) continue;
        const arr = linesByItem.get(l.purchaseItemId) || [];
        arr.push({ ...l, grnNumber: g.grnNumber, receivedAt: g.receivedAt, receivedBy: g.receivedBy, warehouseId: g.warehouseId });
        linesByItem.set(l.purchaseItemId, arr);
      }
    }
    let orderedValue = 0;
    let acceptedValue = 0;
    let shortClosedValue = 0;
    let supplierDamageValue = 0;
    const items = (purchase.items || []).map((i: any) => {
      const lines = linesByItem.get(i.id) || [];
      const received = lines.reduce((s: number, l: any) => s + l.receivedQty, 0);
      const accepted = lines.reduce((s: number, l: any) => s + l.acceptedQty, 0);
      const rejected = lines.reduce((s: number, l: any) => s + l.rejectedQty, 0);
      const shortClosed = i.shortClosedQty || 0;
      const unitBase = i.quantity > 0 ? Number(i.totalBill) / Number(i.quantity) : 0;
      const lineAcceptedValue = lines.reduce((s: number, l: any) => s + Number(l.totalCost), 0);
      const lineSupplierDamage = lines
        .filter((l: any) => l.damageResponsibility !== 'company')
        .reduce((s: number, l: any) => s + l.rejectedQty * unitBase, 0);
      orderedValue += Number(i.totalBill);
      acceptedValue += lineAcceptedValue;
      shortClosedValue += shortClosed * unitBase;
      supplierDamageValue += lineSupplierDamage;
      const remaining = Math.max(0, i.quantity - received - shortClosed);
      return {
        purchaseItemId: i.id,
        ordered: i.quantity,
        received,
        accepted,
        rejected,
        shortClosed,
        shortCloseReason: i.shortCloseReason || null,
        remaining,
        done: accepted + rejected + shortClosed >= i.quantity,
        unitBase,
        lines,
      };
    });
    return {
      items,
      totals: {
        orderedValue,
        acceptedValue,
        shortClosedValue,
        supplierDamageValue,
        remainingQty: items.reduce((s: number, i: any) => s + i.remaining, 0),
      },
    };
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
        warehouse: { select: { id: true, name: true } },
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
