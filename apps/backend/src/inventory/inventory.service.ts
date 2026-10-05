import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { StockRouterService } from '../stock/stock-router.service';
import { CostingLotService, CostingLotShortfallError } from '../stock/costing-lot.service';
import { CacheService } from '../cache/cache.service';
import { ManagedStockLedgerService } from './managed-stock-ledger.service';
import {
  Prisma,
  ManagedStockMovementType,
  MovementDirection,
  ReferenceEntity,
} from '@prisma/client';
import { ValuationQueryDto, StockTransferDto } from './dto/valuation.dto';
import { LedgerQueryDto } from './dto/ledger-query.dto';

/**
 * Shape the product lookup needs: identity + the two stock figures it can fall
 * back to. Deliberately narrow — the old `GET /products` search pulled images,
 * pricing and every relation, then threw most of it away.
 */
const PRODUCT_LOOKUP_SELECT = {
  id: true,
  name: true,
  sku: true,
  type: true,
  managedStockQuantity: true,
  reservedStock: true,
  variants: {
    where: { isActive: { not: false } },
    orderBy: [{ sortOrder: 'asc' as const }, { sku: 'asc' as const }],
    select: {
      id: true,
      sku: true,
      managedStockQuantity: true,
      reservedStock: true,
      attributeValues: {
        include: { attributeValue: { select: { value: true } } },
      },
    },
  },
} satisfies Prisma.ProductSelect;

type ProductLookupRow = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_LOOKUP_SELECT;
}>;

@Injectable()
export class InventoryService {
  /** Hard ceiling on lookup rows — a combobox never needs more than this. */
  private static readonly LOOKUP_MAX_PER_PAGE = 50;
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly stockRouter: StockRouterService,
    private readonly costingLotService: CostingLotService,
    private readonly managedStockLedgerService: ManagedStockLedgerService,
    private readonly cache: CacheService,
  ) {}

  async lowStock() {
    const parseImages = (imgVal: any): string | null => {
      if (!imgVal) return null;
      if (typeof imgVal === 'string') {
        try {
          const parsed = JSON.parse(imgVal);
          return Array.isArray(parsed) && parsed.length ? parsed[0] : imgVal;
        } catch {
          return imgVal;
        }
      }
      if (Array.isArray(imgVal) && imgVal.length) {
        return imgVal[0];
      }
      return null;
    };

    const products = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        slug: string;
        stock: number;
        lowStockQty: number | null;
        sku: string | null;
        images: any;
      }>
    >`
      SELECT id, name, slug, stock, "lowStockQty", sku, images
      FROM "Product"
      WHERE "availabilityMode" = 'MANAGED_STOCK'
        AND "isActive" = true
        AND "type" != 'variable'
        AND stock <= COALESCE("lowStockQty", 5)
      ORDER BY name ASC
    `;
    const lowStockProducts = products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      stock: p.stock,
      lowStockQty: p.lowStockQty,
      sku: p.sku,
      image: parseImages(p.images),
      type: 'product' as const,
    }));

    const variableProducts = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        slug: string;
        sku: string | null;
        lowStockQty: number | null;
        images: any;
        variantId: string;
        variantSku: string | null;
        variantStock: number;
        variantImage: string | null;
        variantAttributes: string | null;
      }>
    >`
      SELECT
        p.id,
        p.name,
        p.slug,
        p.sku,
        p."lowStockQty",
        p.images,
        pv.id AS "variantId",
        pv.sku AS "variantSku",
        pv.stock AS "variantStock",
        pv.image AS "variantImage",
        COALESCE(
          (SELECT string_agg(av.value, ' / ' ORDER BY av.value)
           FROM "ProductVariantAttributeValue" pvav
           JOIN "AttributeValue" av ON av.id = pvav."attributeValueId"
           WHERE pvav."variantId" = pv.id),
          pv.sku
        ) AS "variantAttributes"
      FROM "Product" p
      JOIN "ProductVariant" pv ON pv."productId" = p.id
      WHERE p."isActive" = true
        AND p."type" = 'variable'
        AND p."availabilityMode" = 'MANAGED_STOCK'
        AND pv.stock <= COALESCE(p."lowStockQty", 5)
      ORDER BY p.name ASC
    `;
    const lowStockVariants = variableProducts.map((v) => ({
      id: v.variantId,
      name: v.name,
      slug: v.slug,
      stock: v.variantStock,
      lowStockQty: v.lowStockQty,
      sku: v.sku,
      image: v.variantImage || parseImages(v.images),
      type: 'variant' as const,
      variantSku: v.variantSku || '',
      variantAttributes: v.variantAttributes || v.variantSku || '',
    }));

    const allLowStock = [...lowStockProducts, ...lowStockVariants];
    return { products: allLowStock, count: allLowStock.length };
  }

  async physicalReplenishment() {
    // Products where physical available stock is at or below low stock threshold
    const sql = `
      SELECT
        p.id, p.name, p.sku, p."lowStockQty",
        SUM(pi.quantity) as physical_qty,
        SUM(pi."reservedQuantity") as reserved_qty,
        SUM(pi.quantity) - SUM(pi."reservedQuantity") as available,
        COALESCE(p."lowStockQty", 5) as threshold
      FROM "Product" p
      JOIN "PhysicalInventory" pi ON pi."productId" = p.id
      WHERE p."isActive" = true
      GROUP BY p.id, p.name, p.sku, p."lowStockQty"
      HAVING SUM(pi.quantity) - SUM(pi."reservedQuantity") <= COALESCE(p."lowStockQty", 5)
      ORDER BY p.name ASC
    `;
    const products = await this.prisma.$queryRawUnsafe<any[]>(sql);
    return { products, count: products.length };
  }

  async logs(page = 1, perPage = 20, type?: string, warehouseId?: string, productId?: string) {
    const where: any = {};
    if (type) {
      if (type === 'adjustment') {
        where.type = { in: ['adjustment', 'ADJUSTMENT', 'physical_adjustment', 'PHYSICAL_ADJUSTMENT'] };
      } else if (type === 'transfer') {
        where.type = { in: ['transfer', 'TRANSFER', 'TRANSFER_IN', 'TRANSFER_OUT'] };
      } else if (type === 'sale' || type === 'order_fulfilled') {
        where.type = { in: ['sale', 'SALE', 'order_fulfilled', 'ORDER_FULFILLED', 'DEDUCTION'] };
      } else if (type === 'return') {
        where.type = { in: ['return', 'RETURN'] };
      } else {
        where.type = {
          mode: 'insensitive',
          equals: type,
        };
      }
    }
    if (warehouseId) {
      where.warehouseId = warehouseId;
    }
    if (productId) {
      where.productId = productId;
    }

    const [data, total] = await Promise.all([
      this.prisma.physicalInventoryLedger.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true, images: true } },
          variant: {
            select: {
              id: true,
              sku: true,
              price: true,
              attributeValues: {
                include: {
                  attributeValue: {
                    select: { id: true, value: true, attribute: { select: { name: true } } },
                  },
                },
              },
            },
          },
          warehouse: { select: { id: true, name: true } },
        },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.physicalInventoryLedger.count({ where }),
    ]);

    const mapped = data.map((l) => {
      const prodImages = l.product?.images;
      const firstImage = Array.isArray(prodImages) && prodImages.length ? prodImages[0] : null;
      const variantLabel = l.variant
        ? l.variant.attributeValues
            ?.map((av: any) => av.attributeValue?.value)
            .filter(Boolean)
            .join(' / ') || null
        : null;
      return {
        id: l.id,
        productId: l.productId,
        variantId: l.variantId,
        warehouseId: l.warehouseId,
        quantity: l.quantity,
        direction: l.direction,
        stockBefore: l.stockBefore,
        stockAfter: l.stockAfter,
        reservedBefore: l.reservedBefore ?? null,
        reservedAfter: l.reservedAfter ?? null,
        type: l.type.toLowerCase(),
        reason: l.reason,
        note: l.reason,
        performedBy: l.performedBy || 'System',
        performedAt: l.createdAt,
        productName: l.product?.name || '—',
        variantName: variantLabel,
        sku: l.variant?.sku || l.product?.sku || '—',
        warehouseName: l.warehouse?.name || null,
        image: typeof firstImage === 'string' ? firstImage : null,
      };
    });

    return {
      data: mapped,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  /**
   * Transfer history for the admin History tab: ONE row per logical transfer,
   * never one row per stock movement.
   *
   * A stock move physically writes two ledger legs (TRANSFER_OUT at source,
   * TRANSFER_IN at destination) and — when it came from a POS request — one
   * APPROVE_-keyed StockTransfer header per item on top of the POS_TRF_ request
   * header. Rows are therefore keyed by the origin:
   *   - POS request  → the POS_TRF_ header (status FULFILLED/APPROVAL_FAILED);
   *                    children + both legs are rolled up under it.
   *   - Manual/admin → the executed header itself (IN_PROGRESS/COMPLETED).
   * Each row carries route, product/variant quantities and every movement leg
   * (warehouse, direction, qty, before/after, who, when) so nothing is hidden.
   */
  async listTransfers(
    page = 1,
    perPage = 20,
    search?: string,
    status?: string,
  ) {
    const REQUEST_REP = ['FULFILLED', 'APPROVAL_FAILED'];
    const EXECUTED = ['IN_PROGRESS', 'COMPLETED'];

    const and: any[] = [
      {
        OR: [
          {
            idempotencyKey: { startsWith: 'POS_TRF_' },
            status: { in: REQUEST_REP },
          },
          {
            NOT: { idempotencyKey: { startsWith: 'APPROVE_' } },
            status: { in: EXECUTED },
          },
        ],
      },
    ];

    if (status === 'completed') {
      and.push({
        OR: [
          { status: 'FULFILLED' },
          { status: 'COMPLETED', NOT: { idempotencyKey: { startsWith: 'APPROVE_' } } },
        ],
      });
    } else if (status === 'transit') {
      and.push({
        status: 'IN_PROGRESS',
        NOT: { idempotencyKey: { startsWith: 'APPROVE_' } },
      });
    }

    if (search && search.trim()) {
      const q = search.trim();
      and.push({
        OR: [
          { id: { contains: q, mode: Prisma.QueryMode.insensitive } },
          { idempotencyKey: { contains: q, mode: Prisma.QueryMode.insensitive } },
          { notes: { contains: q, mode: Prisma.QueryMode.insensitive } },
          { sourceWarehouse: { name: { contains: q, mode: Prisma.QueryMode.insensitive } } },
          { destWarehouse: { name: { contains: q, mode: Prisma.QueryMode.insensitive } } },
          { items: { some: { product: { name: { contains: q, mode: Prisma.QueryMode.insensitive } } } } },
        ],
      });
    }

    const where: any = { AND: and };
    const variantInclude = {
      attributeValues: {
        include: {
          attributeValue: { select: { value: true, attribute: { select: { name: true } } } },
        },
      },
    } as const;

    const [rows, total] = await Promise.all([
      this.prisma.stockTransfer.findMany({
        where,
        include: {
          sourceWarehouse: { select: { id: true, name: true, type: true } },
          destWarehouse: { select: { id: true, name: true, type: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
              variant: { include: variantInclude },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);

    // Children of the POS requests on this page (one APPROVE_-keyed header
    // per requested item) — their ledger legs belong to the request's row.
    const requestIds = rows
      .filter((r) => r.idempotencyKey.startsWith('POS_TRF_'))
      .map((r) => r.id);
    const children = requestIds.length
      ? await this.prisma.stockTransfer.findMany({
          where: {
            OR: requestIds.map((id) => ({
              idempotencyKey: { startsWith: `APPROVE_${id}_` },
            })),
          },
          select: { id: true, idempotencyKey: true },
        })
      : [];

    const headerIds = [...rows.map((r) => r.id), ...children.map((c) => c.id)];

    // Index-friendly leg lookup.
    //
    // A leg's reason is "Transfer <id> to <warehouse>", so matching the legs of
    // a page means a MIDDLE substring match — `reason LIKE '%<id>%'` — which no
    // B-tree can serve. With an unbounded ledger and a 30s UI poll that is a
    // sequential scan per poll. Two things make it index-friendly:
    //
    //  1. `contains` (ILIKE '%…%') is served by the pg_trgm GIN index added in
    //     migration 20261006090000_ledger_reason_trgm_index — same predicate,
    //     now an index scan instead of a table scan.
    //  2. The query is additionally narrowed to the warehouses on this page
    //     (every transfer leg is written to its transfer's own source or
    //     destination warehouse, so this drops nothing) which bounds the rows
    //     considered before the trigram match is applied.
    const legWarehouseIds = [
      ...new Set(rows.flatMap((r) => [r.sourceWarehouseId, r.destWarehouseId])),
    ];
    const legs = headerIds.length
      ? await this.prisma.physicalInventoryLedger.findMany({
          where: {
            AND: [
              { OR: headerIds.map((id) => ({ reason: { contains: id } })) },
              { type: { in: ['transfer', 'TRANSFER', 'TRANSFER_IN', 'TRANSFER_OUT'] } },
              { warehouseId: { in: legWarehouseIds } },
            ],
          },
          include: {
            warehouse: { select: { id: true, name: true } },
            product: { select: { id: true, name: true, sku: true } },
            variant: { include: variantInclude },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      : [];

    const variantLabelOf = (v: any): string | null =>
      v
        ? v.attributeValues
            ?.map((av: any) => av.attributeValue?.value)
            .filter(Boolean)
            .join(' / ') || null
        : null;

    const legsFor = (ids: string[]) =>
      legs.filter((l) => ids.some((id) => (l.reason ?? '').includes(id)));

    const data = rows.map((r) => {
      const isRequest = r.idempotencyKey.startsWith('POS_TRF_');
      // child key is APPROVE_<requestId>_<itemId> — match on the request id
      const childIds = isRequest
        ? children
            .filter((c) => c.idempotencyKey.startsWith(`APPROVE_${r.id}_`))
            .map((c) => c.id)
        : [];
      const headerIdsForRow = [r.id, ...childIds];
      const rowLegs = legsFor(headerIdsForRow);

      let items = r.items.map((it) => ({
        productId: it.productId,
        productName: it.product?.name ?? '—',
        productSku: it.product?.sku ?? null,
        variantId: it.variantId,
        variantSku: it.variant?.sku ?? null,
        variantLabel: variantLabelOf(it.variant),
        quantity: it.quantity,
      }));

      if (items.length === 0) {
        // Manual transfers carry no StockTransferItem rows — derive the
        // product/variant quantities from the OUT legs of this header.
        const byKey = new Map<string, any>();
        for (const leg of rowLegs) {
          if (leg.direction !== 'OUT') continue;
          const key = `${leg.productId}::${leg.variantId ?? ''}`;
          const prev = byKey.get(key);
          if (prev) {
            prev.quantity += leg.quantity;
          } else {
            byKey.set(key, {
              productId: leg.productId,
              productName: leg.product?.name ?? '—',
              productSku: leg.product?.sku ?? null,
              variantId: leg.variantId,
              variantSku: leg.variant?.sku ?? null,
              variantLabel: variantLabelOf(leg.variant),
              quantity: leg.quantity,
            });
          }
        }
        items = [...byKey.values()];
      }

      const status =
        r.status === 'FULFILLED'
          ? 'COMPLETED'
          : r.status === 'APPROVAL_FAILED'
            ? 'PARTIAL'
            : r.status;

      return {
        id: r.id,
        kind: isRequest ? 'REQUEST' : 'MANUAL',
        status,
        rawStatus: r.status,
        source: { id: r.sourceWarehouse.id, name: r.sourceWarehouse.name },
        destination: { id: r.destWarehouse.id, name: r.destWarehouse.name },
        items,
        movements: rowLegs.map((l) => ({
          ledgerId: l.id,
          direction: l.direction,
          quantity: l.quantity,
          stockBefore: l.stockBefore,
          stockAfter: l.stockAfter,
          productId: l.productId,
          productName: l.product?.name ?? '—',
          variantId: l.variantId,
          variantLabel: variantLabelOf(l.variant),
          warehouse: l.warehouse ? { id: l.warehouse.id, name: l.warehouse.name } : null,
          performedBy: l.performedBy || 'System',
          performedAt: l.createdAt,
        })),
        notes: r.notes,
        initiatedBy: r.requestedBy || r.performedBy || 'System',
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      };
    });

    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  /** Share of an item's available managed stock a single adjustment may remove. */
  private static readonly DESTRUCTIVE_RATIO = 0.9;

  /**
   * Fallback `available` for a lookup row with no PhysicalInventory rows:
   * managed on-hand minus reserved, floored at 0. `productLookup` overrides it
   * with real physical availability whenever the aggregate has a row for the
   * unit, so this only surfaces for items tracked purely in managed stock.
   */
  private managedAvailable(
    _unit: 'product' | 'variant',
    onHand: number,
    reserved?: number | null,
  ): number {
    return Math.max((onHand ?? 0) - (reserved ?? 0), 0);
  }

  /**
   * Refuse a negative managed-stock adjustment that would remove (nearly) all
   * of the item's AVAILABLE stock unless the caller explicitly confirms it.
   * Mirrors the physical-inventory guard (physical-inventory.controller.ts) so
   * one mis-keyed entry cannot silently zero a managed position — including
   * the reserved-aware case where nothing is available at all.
   */
  private assertNotDestructiveManaged(params: {
    itemName: string;
    onHand: number;
    reserved: number;
    removalQty: number;
    confirmed?: boolean;
  }): void {
    if (params.removalQty <= 0) return;
    if (params.confirmed === true) return;
    const available = params.onHand - params.reserved;
    if (
      available > 0 &&
      params.removalQty / available < InventoryService.DESTRUCTIVE_RATIO
    ) {
      return;
    }
    if (available <= 0) {
      throw new BadRequestException(
        `This adjustment would remove ${params.removalQty} from "${params.itemName}", ` +
          `which has no available stock (${params.onHand} on hand, ${params.reserved} reserved). ` +
          `Re-submit with confirmDestructive=true if this is intentional.`,
      );
    }
    throw new BadRequestException(
      `This adjustment would remove ${params.removalQty} of ${available} available for ` +
        `"${params.itemName}" (${Math.round((params.removalQty / available) * 100)}%). ` +
        `Re-submit with confirmDestructive=true if this is intentional.`,
    );
  }

  async adjust(
    productId?: string,
    quantity?: number,
    reason?: string,
    performedBy?: string,
    variantId?: string,
    comboId?: string,
    confirmDestructive?: boolean,
  ) {
    {
      const guardProduct: any = productId
        ? await this.prisma.product.findUnique({ where: { id: productId } })
        : variantId
          ? (
              await this.prisma.productVariant.findUnique({
                where: { id: variantId },
                include: { product: true },
              })
            )?.product
          : null;

      if (guardProduct) {
        if (guardProduct.availabilityMode === 'ALWAYS_IN_STOCK') {
          throw new BadRequestException(
            'Product is always in stock — no adjustments allowed',
          );
        }
        if (guardProduct.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
          throw new BadRequestException(
            'Product is always out of stock — no adjustments allowed',
          );
        }
        if (guardProduct.availabilityMode === 'INVENTORY_CONTROLLED') {
          throw new BadRequestException(
            'Use Purchase Orders for inventory-controlled products',
          );
        }
        if (!guardProduct.manageStock) {
          throw new BadRequestException(
            'Stock tracking is disabled for this product',
          );
        }
      }
    }

    if (comboId) {
      const combo = await this.prisma.combo.findUnique({
        where: { id: comboId },
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  manageStock: true,
                  managedStockQuantity: true,
                  reservedStock: true,
                },
              },
              variant: {
                select: {
                  id: true,
                  sku: true,
                  managedStockQuantity: true,
                  reservedStock: true,
                },
              },
            },
          },
        },
      });
      if (!combo) throw new NotFoundException('Combo not found');

      const adjusted: {
        productId: string;
        productName: string;
        quantity: number;
      }[] = [];
      const skipped: string[] = [];

      for (const item of combo.items) {
        const qty = (quantity || 0) * item.quantity;

        if (item.variantId) {
          const avail = item.variant?.managedStockQuantity ?? 0;
          if (qty < 0 && avail + qty < 0) {
            throw new BadRequestException(
              `Insufficient stock for variant ${item.variant?.sku ?? 'unknown'}. Available: ${avail}, needed: ${Math.abs(qty)}.`,
            );
          }
          this.assertNotDestructiveManaged({
            itemName: `variant ${item.variant?.sku ?? 'unknown'}`,
            onHand: avail,
            reserved: item.variant?.reservedStock ?? 0,
            removalQty: Math.abs(Math.min(qty, 0)),
            confirmed: confirmDestructive,
          });
          await this.prisma.productVariant.update({
            where: { id: item.variantId },
            data: { managedStockQuantity: { increment: qty } },
          });
          const before = item.variant?.managedStockQuantity ?? 0;
          await this.managedStockLedgerService.record({
            productId: item.productId,
            variantId: item.variantId,
            quantity: Math.abs(qty),
            direction: qty > 0 ? MovementDirection.IN : MovementDirection.OUT,
            type:
              qty > 0
                ? ManagedStockMovementType.MANUAL_ADD
                : ManagedStockMovementType.MANUAL_REMOVE,
            stockBefore: before,
            stockAfter: before + qty,
            referenceType: ReferenceEntity.ADJUSTMENT,
            referenceId: comboId,
            note: reason || `Combo "${combo.name}" stock adjustment`,
            performedById: performedBy,
          });
          adjusted.push({
            productId: item.productId,
            productName: item.product.name,
            quantity: qty,
          });
        } else if (item.product.manageStock) {
          const avail = item.product.managedStockQuantity;
          if (qty < 0 && avail + qty < 0) {
            throw new BadRequestException(
              `Insufficient stock for product ${item.product.name}. Available: ${avail}, needed: ${Math.abs(qty)}.`,
            );
          }
          this.assertNotDestructiveManaged({
            itemName: item.product.name,
            onHand: avail,
            reserved: item.product.reservedStock ?? 0,
            removalQty: Math.abs(Math.min(qty, 0)),
            confirmed: confirmDestructive,
          });
          await this.prisma.product.update({
            where: { id: item.productId },
            data: { managedStockQuantity: { increment: qty } },
          });
          const before = item.product.managedStockQuantity;
          await this.managedStockLedgerService.record({
            productId: item.productId,
            quantity: Math.abs(qty),
            direction: qty > 0 ? MovementDirection.IN : MovementDirection.OUT,
            type:
              qty > 0
                ? ManagedStockMovementType.MANUAL_ADD
                : ManagedStockMovementType.MANUAL_REMOVE,
            stockBefore: before,
            stockAfter: before + qty,
            referenceType: ReferenceEntity.ADJUSTMENT,
            referenceId: comboId,
            note: reason || `Combo "${combo.name}" stock adjustment`,
            performedById: performedBy,
          });
          adjusted.push({
            productId: item.productId,
            productName: item.product.name,
            quantity: qty,
          });
        } else {
          skipped.push(
            `${item.product.name} (stock tracking not enabled — no change needed)`,
          );
        }
      }

      // Combo adjustment writes managedStockQuantity directly (bypassing
      // stockService.operate), so the product cache must be invalidated here.
      await this.cache.invalidateByPrefix('product:');

      return {
        id: combo.id,
        name: combo.name,
        items: adjusted,
        ...(skipped.length > 0 && {
          info: `${skipped.length} item(s) skipped: ${skipped.join('; ')}`,
        }),
      };
    }

    if (variantId) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        include: {
          product: { select: { id: true, name: true, type: true } },
        },
      });
      if (!variant) throw new NotFoundException('Variant not found');
      const q = quantity ?? 0;
      if (q < 0 && variant.managedStockQuantity + q < 0) {
        throw new BadRequestException(
          `Insufficient stock for variant ${variant.sku}. Available: ${variant.managedStockQuantity}, needed: ${Math.abs(q)}.`,
        );
      }
      this.assertNotDestructiveManaged({
        itemName: `variant ${variant.sku}`,
        onHand: variant.managedStockQuantity,
        reserved: variant.reservedStock ?? 0,
        removalQty: Math.abs(Math.min(q, 0)),
        confirmed: confirmDestructive,
      });
      const op =
        q >= 0
          ? this.stockService.add.bind(this.stockService)
          : this.stockService.scrap.bind(this.stockService);
      const targets = await op({
        productId: variant.productId,
        variantId,
        quantity: Math.abs(q),
        reference: reason ? `adjust-${reason}` : 'manual-adjustment',
        performedBy,
        ledgerType: ManagedStockMovementType.ADJUSTMENT,
      });
      return {
        id: variant.id,
        sku: variant.sku,
        stock: variant.managedStockQuantity + q,
        productId: variant.productId,
        productName: variant.product.name,
      };
    }

    if (!productId)
      throw new BadRequestException(
        'Either productId, variantId, or comboId is required',
      );
    const q = quantity ?? 0;

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    if (!product.manageStock) {
      throw new BadRequestException(
        'This product does not manage stock. Stock adjustments are disabled.',
      );
    }

    if (product.type === 'variable') {
      throw new BadRequestException(
        'Variable products use variant-level stock management. Select a specific variant instead.',
      );
    }

    if (q < 0 && product.managedStockQuantity + q < 0) {
      throw new BadRequestException(
        `Insufficient stock for product ${product.name}. Available: ${product.managedStockQuantity}, needed: ${Math.abs(q)}.`,
      );
    }
    this.assertNotDestructiveManaged({
      itemName: product.name,
      onHand: product.managedStockQuantity,
      reserved: product.reservedStock ?? 0,
      removalQty: Math.abs(Math.min(q, 0)),
      confirmed: confirmDestructive,
    });

    return this.adjustProductWithRetry(
      productId,
      q,
      reason || 'Manual stock adjustment',
      performedBy,
    );
  }

  private async adjustProductWithRetry(
    productId: string,
    quantity: number,
    reason: string,
    performedBy?: string,
  ) {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const product = await tx.product.findUnique({
              where: { id: productId },
            });
            if (!product) throw new NotFoundException('Product not found');

            const op =
              quantity >= 0
                ? this.stockService.add.bind(this.stockService)
                : this.stockService.scrap.bind(this.stockService);
            await op({
              productId,
              quantity: Math.abs(quantity),
              reference: `adjust-${reason}`,
              performedBy,
              tx,
              ledgerType: ManagedStockMovementType.ADJUSTMENT,
            });

            return tx.product.findUnique({
              where: { id: productId },
              select: {
                id: true,
                name: true,
                managedStockQuantity: true,
                sku: true,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
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

  async restockOrderItems(
    orderId: string,
    performedBy: string,
    logType: 'refund_restock' | 'cancellation_restock' = 'cancellation_restock',
    force = false,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    const alreadyRestocked =
      !force &&
      (await client.inventoryLog.findFirst({
        where: {
          type: { in: ['refund_restock', 'cancellation_restock'] },
          reason: { contains: orderId },
        },
      }));
    if (alreadyRestocked) return;

    const ledgerType =
      logType === 'refund_restock'
        ? ManagedStockMovementType.RETURN
        : ManagedStockMovementType.CANCEL_RELEASE;

    const orderItems = await client.orderItem.findMany({
      where: { orderId },
    });

    for (const item of orderItems) {
      const product = item.productId
        ? await client.product.findUnique({
            where: { id: item.productId },
            select: {
              id: true,
              availabilityMode: true,
              manageStock: true,
              type: true,
              managedStockQuantity: true,
            },
          })
        : null;

      if (!product) continue;

      const isManaged =
        product.availabilityMode === 'MANAGED_STOCK' ||
        (!product.availabilityMode && product.manageStock);
      const isInventoryControlled =
        product.availabilityMode === 'INVENTORY_CONTROLLED';
      const isAlwaysIn = product.availabilityMode === 'ALWAYS_IN_STOCK';
      const isAlwaysOut = product.availabilityMode === 'ALWAYS_OUT_OF_STOCK';

      if (isAlwaysIn || isAlwaysOut) continue;

      if (item.comboId) {
        const combo = await client.combo.findUnique({
          where: { id: item.comboId },
          include: { items: true },
        });
        if (!combo) continue;

        for (const ci of combo.items) {
          const qty = ci.quantity * item.quantity;
          const effectiveVariantId =
            ci.variantId ||
            (item.comboSelection as Record<string, string> | null)?.[
              ci.productId
            ] ||
            null;

          if (isManaged) {
            const execOp = async (client: any) => {
              if (effectiveVariantId) {
                await this.stockService.add({
                  productId: ci.productId,
                  variantId: effectiveVariantId,
                  quantity: qty,
                  reference: `restock-${orderId}`,
                  tx: client,
                });
              }
              const ciProduct = await client.product.findUnique({
                where: { id: ci.productId },
                select: {
                  manageStock: true,
                  type: true,
                  managedStockQuantity: true,
                },
              });
              if (
                ciProduct?.manageStock &&
                (!effectiveVariantId || ciProduct.type === 'simple')
              ) {
                await this.stockService.add({
                  productId: ci.productId,
                  quantity: qty,
                  reference: `restock-${orderId}`,
                  tx: client,
                });
              }
            };
            if (tx) {
              await execOp(tx);
            } else {
              await this.prisma.$transaction(execOp);
            }
          }

          if (isInventoryControlled || isManaged) {
            await client.inventoryLog.create({
              data: {
                productId: ci.productId,
                variantId: effectiveVariantId,
                comboId: item.comboId,
                quantity: qty,
                type: logType,
                reason: `${logType === 'refund_restock' ? 'Refund' : 'Cancellation'} restock for order ${orderId}`,
                performedBy,
                createdAt: new Date(),
              },
            });
          }

          if (isInventoryControlled && effectiveVariantId) {
            const costAlreadyRestored = !force && await client.costingLotRestoration.findFirst({
              where: { returnReferenceId: orderId },
            });
            if (costAlreadyRestored) continue;

            const invProduct = await client.product.findUnique({
              where: { id: ci.productId },
              select: { warehouseId: true }
            });
            if (invProduct?.warehouseId) {
              await this.stockService.addPhysical({
                productId: ci.productId,
                variantId: effectiveVariantId,
                quantity: qty,
                warehouseId: invProduct.warehouseId,
                reference: `restock-${orderId}`,
                tx: tx || undefined,
              });
              await this.costingLotService.restoreForReturn({
                returnReferenceId: orderId,
                productId: ci.productId,
                variantId: effectiveVariantId,
                warehouseId: invProduct.warehouseId,
                returnQty: qty,
                tx: tx || undefined,
              });
            }
          }
        }
      } else {
        if (isManaged) {
          if (item.variantId) {
            await this.stockService.add({
              productId: item.productId || undefined,
              variantId: item.variantId,
              quantity: item.quantity,
              reference: `restock-${orderId}`,
              tx: tx || undefined,
            });
          }
          if (
            product.manageStock &&
            item.productId &&
            (!item.variantId || product.type === 'simple')
          ) {
            await this.stockService.add({
              productId: item.productId,
              quantity: item.quantity,
              reference: `restock-${orderId}`,
              tx: tx || undefined,
            });
          }
        }

        if (isInventoryControlled || isManaged) {
          await client.inventoryLog.create({
            data: {
              productId: item.productId,
              variantId: item.variantId,
              quantity: item.quantity,
              type: logType,
              reason: `${logType === 'refund_restock' ? 'Refund' : 'Cancellation'} restock for order ${orderId}`,
              performedBy,
              createdAt: new Date(),
            },
          });
        }

        if (isInventoryControlled && item.productId) {
          const costAlreadyRestored = !force && await client.costingLotRestoration.findFirst({
            where: { returnReferenceId: orderId },
          });
          if (costAlreadyRestored) continue;

          const invProduct = await client.product.findUnique({
            where: { id: item.productId },
            select: { warehouseId: true }
          });
          if (invProduct?.warehouseId) {
            await this.stockService.addPhysical({
              productId: item.productId,
              variantId: item.variantId ?? undefined,
              quantity: item.quantity,
              warehouseId: invProduct.warehouseId,
              reference: `restock-${orderId}`,
              tx: tx || undefined,
            });
            await this.costingLotService.restoreForReturn({
              returnReferenceId: orderId,
              productId: item.productId,
              variantId: item.variantId ?? null,
              warehouseId: invProduct.warehouseId,
              returnQty: item.quantity,
              tx: tx || undefined,
            });
          }
        }
      }
    }
  }

  async stockOverview(params: {
    page?: number;
    perPage?: number;
    search?: string;
    categoryId?: string;
    type?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = params.page || 1;
    const perPage = params.perPage || 20;
    const where: any = { isActive: true };

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { sku: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.categoryId) where.categoryId = params.categoryId;
    if (params.type) where.type = params.type;

    const orderBy: any = {};
    if (params.sortBy === 'name') orderBy.name = params.sortOrder || 'asc';
    else if (params.sortBy === 'stock')
      orderBy.managedStockQuantity = params.sortOrder || 'desc';
    else if (params.sortBy === 'price')
      orderBy.basePrice = params.sortOrder || 'desc';
    else orderBy.updatedAt = 'desc';

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy,
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          type: true,
          availabilityMode: true,
          managedStockQuantity: true,
          manageStock: true,
          reservedStock: true,
          lowStockQty: true,
          basePrice: true,
          salePrice: true,
          images: true,
          categoryId: true,
          category: { select: { id: true, name: true } },
          variants: {
            select: {
              id: true,
              sku: true,
              managedStockQuantity: true,
              reservedStock: true,
              price: true,
              attributeValues: {
                include: { attributeValue: { select: { value: true } } },
              },
            },
          },
          _count: { select: { orderItems: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    const productIds = data.map((p) => p.id);
    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();

    // Group physical inventory by (productId, variantId) to get per-variant sums.
    // variantId=null rows belong to simple (non-variant) products.
    const physicalSums = imEnabled ? await this.prisma.physicalInventory.groupBy({
      by: ['productId', 'variantId'],
      _sum: { quantity: true, reservedQuantity: true },
      where: { productId: { in: productIds } },
    }) : [];

    // Per-variant physical stock maps (keyed by ProductVariant.id)
    const variantPhysicalSumMap = new Map<string, number>();
    const variantReservedSumMap = new Map<string, number>();
    // Product-level totals (sum of ALL rows for that product, incl. all variants)
    const productPhysicalSumMap = new Map<string, number>();
    const productReservedSumMap = new Map<string, number>();

    for (const s of physicalSums) {
      const qty = s._sum.quantity ?? 0;
      const res = s._sum.reservedQuantity ?? 0;
      // Accumulate product-level totals unconditionally
      productPhysicalSumMap.set(s.productId, (productPhysicalSumMap.get(s.productId) ?? 0) + qty);
      productReservedSumMap.set(s.productId, (productReservedSumMap.get(s.productId) ?? 0) + res);
      // Accumulate variant-level totals only when variantId is present
      if (s.variantId) {
        variantPhysicalSumMap.set(s.variantId, (variantPhysicalSumMap.get(s.variantId) ?? 0) + qty);
        variantReservedSumMap.set(s.variantId, (variantReservedSumMap.get(s.variantId) ?? 0) + res);
      }
    }

    const dataWithAvailableStock = data.map((p) => {
      const physicalStockSum = productPhysicalSumMap.get(p.id) ?? 0;
      const physicalReservedSum = productReservedSumMap.get(p.id) ?? 0;
      // For MANAGED_STOCK: aggregate from variant managedStockQuantity fields
      const managedStockSum = p.type === 'variable'
        ? p.variants.reduce((sum, v) => sum + (v.managedStockQuantity ?? 0), 0)
        : p.managedStockQuantity;

      const managedReservedSum = p.type === 'variable'
        ? p.variants.reduce((sum, v) => sum + (v.reservedStock ?? 0), 0)
        : p.reservedStock ?? 0;

      return {
        ...p,
        managedStockQuantity: managedStockSum,
        reservedStock: p.availabilityMode === 'MANAGED_STOCK' ? managedReservedSum : p.reservedStock,
        _physicalStock: physicalStockSum,
        availableStock:
          p.availabilityMode === 'MANAGED_STOCK'
            ? managedStockSum - managedReservedSum
            : p.availabilityMode === 'INVENTORY_CONTROLLED'
              ? physicalStockSum - physicalReservedSum
              : p.availabilityMode === 'ALWAYS_IN_STOCK'
                ? null
                : 0,
        variants: p.variants.map((v) => {
          // For INVENTORY_CONTROLLED variants: use exact variantId-scoped physical sum.
          // For MANAGED_STOCK variants: use the variant's own managedStockQuantity.
          const vPhysical = variantPhysicalSumMap.get(v.id) ?? 0;
          const vReserved = variantReservedSumMap.get(v.id) ?? 0;
          return {
            ...v,
            availableStock:
              p.availabilityMode === 'MANAGED_STOCK'
                ? v.managedStockQuantity - (v.reservedStock ?? 0)
                : p.availabilityMode === 'INVENTORY_CONTROLLED'
                  ? vPhysical - vReserved
                  : p.availabilityMode === 'ALWAYS_IN_STOCK'
                    ? null
                    : 0,
          };
        }),
      };
    });

    return {
      data: dataWithAvailableStock,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  /**
   * Variant-level product lookup for the stock-transfer modal.
   *
   * Why this exists: the transfers modal used to search `GET /products`, which
   * runs `enrichProductsWithAvailableStock` + a `PhysicalInventory.groupBy`
   * across 50 rows per keystroke and, worse, returns the PARENT of a variable
   * product (whose `Product.sku` is null) as a selectable row. This endpoint
   * answers the question the UI actually asks — "which stock unit does this
   * term refer to?" — with one row per selectable unit.
   *
   * Matching (all case-insensitive substrings; the SKU columns are trigram
   * indexed via `Product_sku_trgm_idx` / `ProductVariant_sku_trgm_idx`):
   *   - product name
   *   - Product.sku          (the parent SKU of a variable product)
   *   - ProductVariant.sku   (the per-variant code a scanner prints)
   *
   * An exact SKU hit (product- or variant-level) is hoisted to the front: a
   * warehouse scanner emits a full code, and "12 matches, right one buried in
   * the middle" is never acceptable there.
   *
   * A VARIABLE product fans out into one row per ACTIVE variant — never a bare
   * parent row — so a parent-SKU search forces the user to pick a variant
   * instead of silently transferring product-level stock. SIMPLE products emit
   * a single row with `variantId: null`.
   *
   * There is no separate product-code/barcode column in the schema:
   * `Product.sku` and `ProductVariant.sku` are the only codes.
   */
  async productLookup(params: {
    q?: string;
    warehouseId?: string;
    perPage?: number;
  }) {
    const perPage = Math.min(
      Math.max(params.perPage ?? 25, 1),
      InventoryService.LOOKUP_MAX_PER_PAGE,
    );
    const q = (params.q ?? '').trim();

    // No term → no results. Without this the popover would return the first N
    // products of the whole catalogue the moment it opened.
    if (!q) {
      return { data: [], meta: { total: 0, perPage } };
    }

    const lowered = q.toLowerCase();
    const matches: Array<{
      key: string;
      productId: string;
      productName: string;
      productSku: string | null;
      variantId: string | null;
      variantName: string | null;
      sku: string | null;
      type: 'product' | 'variant';
      available: number;
      /** True when `sku` or the parent `Product.sku` is an exact hit. */
      exactSku: boolean;
    }> = [];

    const where: Prisma.ProductWhereInput = {
      isActive: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
        { variants: { some: { sku: { contains: q, mode: 'insensitive' } } } },
      ],
    };

    // Cursors, not skip/take: fanning a variable product out into its variants
    // changes the row count, so page offsets would drop or repeat rows. The
    // product cursor is capped well below the row cap so a handful of
    // 40-variant products can never blow past LOOKUP_MAX_PER_PAGE rows.
    const maxProducts = Math.max(1, Math.ceil(perPage / 2));
    const pageSize = Math.min(perPage, maxProducts);
    let cursor: string | undefined;
    const seen = new Set<string>();

    while (matches.length < perPage && seen.size < maxProducts) {
      const page: ProductLookupRow[] = await this.prisma.product.findMany({
        where,
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        select: PRODUCT_LOOKUP_SELECT,
      });
      // Page through with a cursor until the products run out (a short page) or
      // the row cap is reached. The row cap is checked on `matches`, never on
      // `page.length` — a variable product contributes several rows per product,
      // so the product count can lag well behind the row count.
      for (const p of page) {
        seen.add(p.id);

        // A VARIABLE product fans out per ACTIVE variant and NEVER emits a bare
        // parent row — that parent row is what used to be silently selectable.
        if (p.type === 'variable') {
          for (const v of p.variants) {
            const key = `${p.id}:${v.id}`;
            if (matches.length >= perPage) break;
            matches.push({
              key,
              productId: p.id,
              productName: p.name,
              productSku: p.sku,
              variantId: v.id,
              variantName:
                v.attributeValues
                  .map((av) => av.attributeValue?.value)
                  .filter(Boolean)
                  .join(' / ') || v.sku,
              sku: v.sku,
              type: 'variant',
              available: this.managedAvailable('variant', v.managedStockQuantity, v.reservedStock),
              exactSku: v.sku.toLowerCase() === lowered || p.sku?.toLowerCase() === lowered,
            });
          }
          continue;
        }

        // Simple product: one row, the product-level stock unit. Variants on a
        // non-variable product stay out — they are not stock units here.
        matches.push({
          key: `${p.id}:`,
          productId: p.id,
          productName: p.name,
          productSku: p.sku,
          variantId: null,
          variantName: null,
          sku: p.sku,
          type: 'product',
          available: this.managedAvailable('product', p.managedStockQuantity, p.reservedStock),
          exactSku: p.sku?.toLowerCase() === lowered,
        });
      }

      // Short page → no more products behind the cursor.
      if (page.length < pageSize) break;
      cursor = page[page.length - 1].id;
    }

    // Physical availability (quantity − reserved) for the resolved rows only:
    // ONE grouped aggregate keyed by (productId, variantId), optionally scoped
    // to a warehouse. Replaces the per-keystroke enrich + groupBy over 50 rows.
    const physicalByKey = new Map<string, number>();
    if (matches.length > 0) {
      const physical = await this.prisma.physicalInventory.groupBy({
        by: ['productId', 'variantId'],
        where: {
          productId: { in: [...new Set(matches.map((m) => m.productId))] },
          ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
        },
        _sum: { quantity: true, reservedQuantity: true },
      });
      for (const s of physical) {
        physicalByKey.set(
          `${s.productId}:${s.variantId ?? ''}`,
          (s._sum.quantity ?? 0) - (s._sum.reservedQuantity ?? 0),
        );
      }
    }

    // Exact-SKU hits first, then name matches. A scanner always prints a code.
    matches.sort((a, b) => {
      if (a.exactSku !== b.exactSku) return a.exactSku ? -1 : 1;
      const byName = a.productName.localeCompare(b.productName);
      if (byName !== 0) return byName;
      return (a.sku ?? '').localeCompare(b.sku ?? '');
    });

    const data = matches.map(({ key, exactSku, productSku, ...row }) => ({
      ...row,
      // No PhysicalInventory rows for this unit → keep the managed figure.
      available: physicalByKey.has(key) ? physicalByKey.get(key)! : row.available,
    }));

    return { data, meta: { total: data.length, perPage } };
  }


  async bulkAdjust(
    items: {
      productId?: string;
      variantId?: string;
      comboId?: string;
      quantity: number;
      reason: string;
      confirmDestructive?: boolean;
    }[],
    performedBy?: string,
  ) {
    const results: any[] = [];
    for (const item of items) {
      try {
        const result = await this.adjust(
          item.productId,
          item.quantity,
          item.reason,
          performedBy,
          item.variantId,
          item.comboId,
          item.confirmDestructive,
        );
        results.push({ ...item, success: true, result });
      } catch (err: any) {
        results.push({ ...item, success: false, error: err.message });
      }
    }
    return { results, totalAdjusted: results.filter((r) => r.success).length };
  }

  async valuation(query: ValuationQueryDto) {
    // Physical Inventory Valuation (FIFO CostingLot-based)
    // Returns per-product: physical_qty, lot_remaining_qty, fifo_value, reconciliation_status
    const whereConditions: string[] = ['p."isActive" = true'];
    const params: any[] = [];

    if (query.categoryId) {
      params.push(query.categoryId);
      whereConditions.push(`p."categoryId" = $${params.length}`);
    }
    if (query.search) {
      params.push(`%${query.search}%`);
      whereConditions.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')} AND`
      : 'WHERE';

    const sql = `
      WITH pi_agg AS (
        SELECT "productId", SUM(quantity) as total_qty, SUM("reservedQuantity") as total_reserved
        FROM "PhysicalInventory"
        GROUP BY "productId"
      ),
      cl_agg AS (
        SELECT "productId", SUM("remainingQty" * "unitCost") as fifo_value, SUM("remainingQty") as lot_qty
        FROM "CostingLot"
        WHERE "remainingQty" > 0
        GROUP BY "productId"
      )
      SELECT
        p.id, p.name, p.sku, p."standardCost",
        COALESCE(pi_agg.total_qty, 0) as physical_qty,
        COALESCE(pi_agg.total_reserved, 0) as physical_reserved,
        COALESCE(cl_agg.fifo_value, 0) as fifo_value,
        COALESCE(cl_agg.lot_qty, 0) as lot_qty,
        CASE
          WHEN COALESCE(pi_agg.total_qty, 0) != COALESCE(cl_agg.lot_qty, 0)
          THEN 'RECONCILIATION_NEEDED'
          ELSE 'OK'
        END as reconciliation_status
      FROM "Product" p
      LEFT JOIN pi_agg ON pi_agg."productId" = p.id
      LEFT JOIN cl_agg ON cl_agg."productId" = p.id
      ${whereClause} COALESCE(pi_agg.total_qty, 0) > 0
      ORDER BY p.name ASC
    `;

    const rows = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);

    let totalValue = 0;
    let totalPhysicalQty = 0;
    let totalLotQty = 0;
    const items: any[] = [];

    for (const row of rows) {
      const fifoValue = Number(row.fifo_value);
      totalValue += fifoValue;
      totalPhysicalQty += Number(row.physical_qty);
      totalLotQty += Number(row.lot_qty);
      items.push({
        id: row.id,
        type: 'product',
        name: row.name,
        sku: row.sku,
        physicalQty: Number(row.physical_qty),
        physicalReserved: Number(row.physical_reserved),
        lotRemainingQty: Number(row.lot_qty),
        unitCost: Number(row.standardCost) || 0,
        fifoValue,
        reconciliationStatus: row.reconciliation_status,
      });
    }

    return {
      items,
      totalValue,
      totalPhysicalQty,
      totalLotQty,
      count: items.length,
      type: 'physical_inventory_valuation',
    };
  }

  async managedStockValue(query: ValuationQueryDto) {
    // Managed Stock Value (lightweight, standardCost-based)
    const where: any = { isActive: true, availabilityMode: 'MANAGED_STOCK' };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const products = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        sku: true,
        managedStockQuantity: true,
        standardCost: true,
        variants: {
          select: {
            id: true,
            sku: true,
            managedStockQuantity: true,
          },
        },
      },
    });

    let totalValue = 0;
    let totalStock = 0;
    const items: any[] = [];

    for (const product of products) {
      const cost = Number(product.standardCost) || 0;
      if (product.variants.length > 0) {
        for (const v of product.variants) {
          totalValue += cost * v.managedStockQuantity;
          totalStock += v.managedStockQuantity;
          items.push({
            id: v.id,
            type: 'variant',
            sku: v.sku,
            stock: v.managedStockQuantity,
            unitCost: cost,
            totalValue: cost * v.managedStockQuantity,
          });
        }
      } else {
        totalValue += cost * product.managedStockQuantity;
        totalStock += product.managedStockQuantity;
        items.push({
          id: product.id,
          type: 'product',
          name: product.name,
          sku: product.sku,
          stock: product.managedStockQuantity,
          unitCost: cost,
          totalValue: cost * product.managedStockQuantity,
        });
      }
    }

    return { items, totalValue, totalStock, count: items.length, type: 'managed_stock_value' };
  }

  async getLedger(query: LedgerQueryDto) {
    return this.managedStockLedgerService.find({
      productId: query.productId,
      variantId: query.variantId,
      page: query.page,
      perPage: query.perPage,
    });
  }

  /**
   * Move stock between two warehouses.
   *
   * Correctness rules this method now upholds:
   *  · A variable product must be transferred AT VARIANT level — a product-level
   *    transfer creates PhysicalInventory rows with variantId NULL that no
   *    variant can ever consume (orphaned stock).
   *  · Source deduction always goes through StockService.deductPhysical, so
   *    the availability checks (ALWAYS_IN/OUT_OF_STOCK) and the reserved-aware
   *    ledger are identical whether or not a source bin was named. A transfer
   *    never reserved anything, so reservedQuantity is left alone.
   *  · The deduction is guarded: a concurrent movement cannot drive the bin
   *    negative.
   *  · FIFO costing must cover the whole movement. A cost shortfall surfaces as
   *    a PARTIAL transfer, never a silent COMPLETED one with lost valuation.
   *  · Idempotency is enforced INSIDE the transaction (unique key + P2002
   *    recovery), so two concurrent requests with one key cannot both execute.
   */
  async transfer(
    dto: StockTransferDto,
    performedBy?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx ?? this.prisma;

    const [product, sourceWarehouse, destWarehouse] = await Promise.all([
      prisma.product.findUnique({
        where: { id: dto.productId },
        select: { id: true, name: true, managedStockQuantity: true, type: true },
      }),
      prisma.warehouse.findUnique({ where: { id: dto.sourceLocation } }),
      prisma.warehouse.findUnique({
        where: { id: dto.destinationLocation },
      }),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!sourceWarehouse) {
      throw new NotFoundException(
        `Source warehouse ${dto.sourceLocation} not found`,
      );
    }
    if (!destWarehouse) {
      throw new NotFoundException(
        `Destination warehouse ${dto.destinationLocation} not found`,
      );
    }

    // Variable products hold their stock on variants. A transfer without a
    // variantId would write PhysicalInventory rows with variantId NULL that no
    // variant can ever consume — stock that exists in the warehouse but is
    // invisible to (and undeductible by) every variant-level path. Same guard
    // as the physical-adjust path (physical-inventory.controller.ts).
    if (!dto.variantId && product.type === 'variable') {
      throw new BadRequestException(
        'Variable products use variant-level stock management. Select a specific variant to transfer instead.',
      );
    }

    // Idempotency check — INSIDE the transaction, so two concurrent requests
    // carrying the same key cannot both pass it. The unique index on
    // idempotencyKey is the real arbiter; P2002 is handled below.
    const existing = await prisma.stockTransfer.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) return existing;

    try {
      return await this.executeTransfer(dto, product, sourceWarehouse, destWarehouse, performedBy, prisma);
    } catch (err) {
      // Two concurrent requests, same key: this one lost the unique index
      // race. The winner's transfer IS the answer — return it rather than
      // reporting a failure for a movement that already happened.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        this.isStockTransferIdempotencyConflict(err)
      ) {
        const winner = await this.prisma.stockTransfer.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (winner) return winner;
      }
      throw err;
    }
  }

  /**
   * Was this unique violation on StockTransfer.idempotencyKey (as opposed to
   * some other constraint failing in the same transaction)?
   */
  private isStockTransferIdempotencyConflict(
    err: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    const target = (err.meta as { target?: unknown } | undefined)?.target;
    const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
    return fields.some((f) => f.includes('idempotencyKey'));
  }

  private async executeTransfer(
    dto: StockTransferDto,
    product: { id: string; name: string },
    sourceWarehouse: { id: string; name: string },
    destWarehouse: { id: string; name: string },
    performedBy: string | undefined,
    prisma: Prisma.TransactionClient,
  ) {
    // Create StockTransfer header
    const transfer = await prisma.stockTransfer.create({
      data: {
        idempotencyKey: dto.idempotencyKey,
        sourceWarehouseId: dto.sourceLocation,
        destWarehouseId: dto.destinationLocation,
        status: 'IN_PROGRESS',
        notes: dto.notes,
        performedBy,
      },
    });

    const result = {
      id: transfer.id,
      productId: product.id,
      productName: product.name,
      quantity: dto.quantity,
      source: dto.sourceLocation,
      destination: dto.destinationLocation,
    };

    // Consume FIFO costing lots from source warehouse with exact lineage.
    // This runs BEFORE the physical moves so a cost shortfall aborts the whole
    // transfer (nothing has moved yet) rather than leaving stock moved with no
    // cost basis.
    let consumedLots: {
      lotId: string;
      quantity: number;
      unitCost: Prisma.Decimal;
    }[];
    try {
      consumedLots = await this.costingLotService.consumeFIFO({
        productId: dto.productId,
        variantId: dto.variantId ?? null,
        warehouseId: dto.sourceLocation,
        quantity: dto.quantity,
        type: 'TRANSFER_OUT',
        referenceType: 'STOCK_TRANSFER',
        referenceId: transfer.id,
        tx: prisma,
      });
    } catch (err) {
      // Costing lots do not cover the movement. Record the transfer as
      // PARTIAL (visible to reconciliation + the transfers screen) and tell the
      // caller the stock was NOT moved — never a silent COMPLETED transfer with
      // understated valuation.
      if (err instanceof CostingLotShortfallError) {
        await prisma.stockTransfer.update({
          where: { id: transfer.id },
          data: {
            status: 'PARTIAL',
            completedAt: new Date(),
            notes:
              `${dto.notes ?? ''} — not executed: ${err.shortfall} of ${dto.quantity} unit(s) have no cost basis at ${sourceWarehouse.name}. ${err.message}`.trim(),
          },
        });
      }
      throw err;
    }

    // Deduct physical stock from the source.
    //
    // ONE path for both cases: with a source bin the stock comes from that bin,
    // without one the warehouse's PhysicalInventory rows supply it. deductPhysical
    // is the single gateway (availability checks + guarded decrement +
    // reserved-aware ledger), so the no-bin case can no longer diverge from the
    // bin case.
    //
    // consumesReservation:false — a transfer moves stock that was never
    // reserved, so reservedQuantity must stay untouched (see operatePhysical).
    await this.stockService.deductPhysical({
      productId: dto.productId,
      variantId: dto.variantId,
      quantity: dto.quantity,
      warehouseId: dto.sourceLocation,
      binLocationId: dto.sourceBinId,
      reference: `Transfer ${transfer.id} to ${destWarehouse.name}`,
      performedBy,
      ledgerType: 'TRANSFER_OUT',
      consumesReservation: false,
      tx: prisma,
    });

    // Create destination CostingLots with exact cost from source
    for (const consumed of consumedLots) {
      const destLotNumber = `TRF-${transfer.id.slice(0, 8)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const consumption = await prisma.costingLotConsumption.findFirst({
        where: {
          costingLotId: consumed.lotId,
          type: 'TRANSFER_OUT',
          referenceType: 'STOCK_TRANSFER',
          referenceId: transfer.id,
        },
        select: { id: true },
      });
      await prisma.costingLot.create({
        data: {
          productId: dto.productId,
          variantId: dto.variantId,
          warehouseId: dto.destinationLocation,
          lotNumber: destLotNumber,
          unitCost: consumed.unitCost,
          totalCost: consumed.unitCost.mul(consumed.quantity),
          quantity: consumed.quantity,
          remainingQty: consumed.quantity,
          receivedAt: new Date(),
          transferId: transfer.id,
          sourceConsumptionId: consumption?.id,
        },
      });
    }

    // Add physical stock to destination
    await this.stockService.addPhysical({
      productId: dto.productId,
      variantId: dto.variantId,
      quantity: dto.quantity,
      warehouseId: dto.destinationLocation,
      binLocationId: dto.destinationBinId,
      reference: `Transfer ${transfer.id} from ${sourceWarehouse.name}`,
      performedBy,
      ledgerType: 'TRANSFER_IN',
      tx: prisma,
    });

    await prisma.inventoryLog.create({
      data: {
        productId: dto.productId,
        variantId: dto.variantId,
        quantity: dto.quantity,
        type: 'transfer',
        reason: `Transferred ${dto.quantity} units from ${sourceWarehouse.name} to ${destWarehouse.name}${dto.notes ? ': ' + dto.notes : ''}`,
        performedBy,
      },
    });

    // Mark transfer complete
    await prisma.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    return result;
  }

  /**
   * Statuses that identify a transfer REQUEST as opposed to a transfer that
   * transfer() executed (those end up IN_PROGRESS → COMPLETED). A request
   * moves REQUESTED → APPROVING → FULFILLED, or → REJECTED / APPROVAL_FAILED.
   */
  private static readonly REQUEST_STATUSES = [
    'REQUESTED',
    'APPROVING',
    'FULFILLED',
    'REJECTED',
    'APPROVAL_FAILED',
  ];

  private async attachRequesters<T extends { requestedBy: string | null }>(
    rows: T[],
  ): Promise<Array<T & { requestedByUser: { id: string; firstName: string; lastName: string; email: string } | null }>> {
    const ids = [...new Set(rows.map((r) => r.requestedBy).filter(Boolean))] as string[];
    const users = ids.length
      ? await this.prisma.userProfile.findMany({
          where: { id: { in: ids } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((row) => ({
      ...row,
      requestedByUser: row.requestedBy ? byId.get(row.requestedBy) ?? null : null,
    }));
  }

  /**
   * POS transfer requests, newest first (pending + recently handled).
   *
   * Paginated: an unpaginated `take: 100` silently truncates once more than
   * 100 requests exist, so an older pending request becomes invisible and can
   * never be approved. The caller gets a page plus meta like every other list
   * endpoint here.
   */
  async listTransferRequests(page = 1, perPage = 20) {
    const where = { status: { in: InventoryService.REQUEST_STATUSES } };
    const [rows, total] = await Promise.all([
      this.prisma.stockTransfer.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          sourceWarehouse: { select: { id: true, name: true, type: true } },
          destWarehouse: { select: { id: true, name: true, type: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
              variant: { select: { id: true, sku: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);
    return {
      data: await this.attachRequesters(rows),
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  private async getTransferRequest(id: string) {
    const row = await this.prisma.stockTransfer.findUnique({
      where: { id },
      include: {
        sourceWarehouse: { select: { id: true, name: true, type: true } },
        destWarehouse: { select: { id: true, name: true, type: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            variant: { select: { id: true, sku: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Transfer request not found');
    const [enriched] = await this.attachRequesters([row]);
    return enriched;
  }

  /**
   * Execute a POS transfer request: claims it with a compare-and-swap so two
   * approvers can never both move the stock, then runs the regular transfer()
   * pipeline (source deduction + ledger + FIFO costing lots + destination add)
   * once per item — ALL ITEMS IN ONE TRANSACTION, so a failure on item N cannot
   * leave items 1..N-1 already moved.
   */
  async approveTransferRequest(id: string, performedBy: string) {
    // Claim → move every item → confirm, all inside ONE transaction.
    //
    // Previously each item ran its own transaction, so an N-item request that
    // failed on item N had already moved N-1 items' stock: a rejected shelf
    // quantity left the source warehouse short with no way to unwind it, and
    // the request was left APPROVAL_FAILED with a partial movement nobody could
    // reconcile. One transaction means all-or-nothing: a failure rolls back
    // every deduction, destination add and costing-lot movement together.
    const executed: string[] = [];
    let requestItems: any[] = [];
    try {
      await this.prisma.$transaction(async (tx) => {
        const request = await tx.stockTransfer.findUnique({
          where: { id },
          include: { items: true },
        });
        if (!request) throw new NotFoundException('Transfer request not found');
        if (request.items.length === 0) {
          throw new BadRequestException('Transfer request has no items to move');
        }
        if (request.status !== 'REQUESTED') {
          throw new ConflictException(
            `Transfer request is already ${request.status.toLowerCase().replace('_', ' ')}`,
          );
        }
        requestItems = request.items;

        // Compare-and-swap claim: two approvers can never both move the stock.
        const claimed = await tx.stockTransfer.updateMany({
          where: { id, status: 'REQUESTED' },
          data: { status: 'APPROVING' },
        });
        if (claimed.count !== 1) {
          throw new ConflictException('Transfer request was already handled');
        }

        for (const item of request.items) {
          const movement = await this.transfer(
            {
              productId: item.productId,
              variantId: item.variantId ?? undefined,
              sourceLocation: request.sourceWarehouseId,
              destinationLocation: request.destWarehouseId,
              quantity: item.quantity,
              notes: `Approved POS transfer request ${request.id}`,
              idempotencyKey: `APPROVE_${request.id}_${item.id}`,
            },
            performedBy,
            tx,
          );
          executed.push(movement.id);
        }

        await tx.stockTransfer.update({
          where: { id },
          data: {
            status: 'FULFILLED',
            completedAt: new Date(),
            notes: `${request.notes ?? ''} — fulfilled: ${executed.join(', ')}`.trim(),
          },
        });
      });
    } catch (err) {
      // The movement transaction rolled back, so no stock moved. The request is
      // closed out explicitly (outside the rolled-back transaction) so it is
      // never silently left APPROVING and re-approvable.
      const failure = (err as Error).message ?? 'unknown error';
      await this.prisma.stockTransfer.updateMany({
        where: { id, status: { in: ['REQUESTED', 'APPROVING'] } },
        data: {
          status: 'APPROVAL_FAILED',
          notes: `approval failed, no stock moved (0/${requestItems.length || '?'} item(s)): ${failure}`.trim(),
        },
      });
      throw err;
    }

    return this.getTransferRequest(id);
  }

  async rejectTransferRequest(id: string, performedBy: string, reason?: string) {
    const request = await this.prisma.stockTransfer.findUnique({
      where: { id },
      select: { id: true, status: true, notes: true },
    });
    if (!request) throw new NotFoundException('Transfer request not found');

    const detail = [
      'rejected',
      reason?.trim() ? `reason: ${reason.trim()}` : null,
      `by ${performedBy}`,
    ]
      .filter(Boolean)
      .join(', ');

    const updated = await this.prisma.stockTransfer.updateMany({
      where: { id, status: 'REQUESTED' },
      data: {
        status: 'REJECTED',
        notes: `${request.notes ?? ''} — ${detail}`.trim(),
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException(
        `Transfer request is already ${request.status.toLowerCase().replace('_', ' ')}`,
      );
    }

    return this.getTransferRequest(id);
  }
}
