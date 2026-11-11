import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProductDto,
  UpdateProductDto,
  GenerateVariantsDto,
  UpdateVariantDto,
} from './dto/product.dto';
import { CustomizationService } from '../customization/customization.service';
import { MediaService } from '../media/media.service';
import { MediaResolverService } from '../media/media-resolver.service';
import {
  extractUploadImagePaths,
  rewriteUploadImages,
} from '../media/html-image-rewrite';
import { CacheService } from '../cache/cache.service';
import { StockRouterService } from '../stock/stock-router.service';
import { StockService } from '../stock/stock.service';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The price a product card sorts/displays by (PLP scale round) — the
 * EXACT semantics the retired in-memory sort in findAll computed per
 * request, now persisted on Product.effectivePrice and maintained on
 * every price-affecting write:
 *   - variable product with at least one priced variant: the minimum
 *     over ALL variants (no isActive filter — the old read had none) of
 *     (salePrice ?? price), counting only variants whose coalesced
 *     price is a number > 0;
 *   - otherwise (simple product, or no priced variant exists):
 *     salePrice ?? basePrice, with a non-numeric result collapsing to 0.
 * The migration backfill (20261105120000_product_effective_price)
 * mirrors this in SQL; the two must never drift apart.
 */
export function computeEffectivePrice(
  product: { type?: string | null; basePrice?: unknown; salePrice?: unknown },
  variants?: Array<{ price?: unknown; salePrice?: unknown }> | null,
): number {
  if (product.type === 'variable' && variants && variants.length > 0) {
    const prices = variants
      .map((v) => Number(v.salePrice ?? v.price))
      .filter((price) => !isNaN(price) && price > 0);
    if (prices.length > 0) {
      return Math.min(...prices);
    }
  }
  return Number(product.salePrice ?? product.basePrice) || 0;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly cache: CacheService,
    private readonly stockRouter: StockRouterService,
    private readonly mediaResolver: MediaResolverService,
    private readonly stockService: StockService,
    private readonly customization: CustomizationService,
  ) {}

  /**
   * Customization definition gate + normalization (owner Q15/Q20):
   * malformed definitions are rejected; the NORMALIZED parse (defaults
   * materialized) is what's stored. Setting a non-empty definition
   * requires the 'product-customization' license feature; clearing
   * (null/[]) is always allowed.
   */
  private normalizeCustomizations(raw: unknown): any {
    const parsed = this.customization.parseDefinition(raw);
    if (parsed.length === 0) return null;
    this.customization.assertEnabled();
    return parsed;
  }

  /**
   * Video URLs are stored trimmed: a padded value otherwise ships a broken
   * link to the storefront. `undefined` stays `undefined` (write path leaves
   * the column untouched), `null` stays `null` (explicit clear), and a
   * whitespace-only value clears the field instead of storing blanks.
   */
  private normalizeVideoUrl(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Variant SKUs are globally unique in the DB (ProductVariant.sku @unique),
   * including drafts — but the old availability check excluded drafts, so a
   * "free" SKU could 500 the final save. Pre-check here so every write path
   * fails with a named 409 instead of a raw Prisma 500.
   */
  private async assertVariantSkusFree(
    variants: Array<{ sku?: string }> | undefined,
    excludeProductId?: string,
  ): Promise<void> {
    if (!variants?.length) return;
    const skus = variants.map((v) => (v.sku || '').trim()).filter(Boolean);
    const seen = new Set<string>();
    for (const sku of skus) {
      if (seen.has(sku)) {
        throw new ConflictException(
          `Variant SKU already in use: ${sku} (used twice in this product)`,
        );
      }
      seen.add(sku);
    }
    if (skus.length === 0) return;
    const clash = await this.prisma.productVariant.findFirst({
      where: {
        sku: { in: skus },
        ...(excludeProductId
          ? { productId: { not: excludeProductId } }
          : {}),
      },
      select: { sku: true },
    });
    if (clash) {
      throw new ConflictException(
        `Variant SKU already in use: ${clash.sku} — change it to a unique SKU and try again`,
      );
    }
  }

  /** Map raw Prisma write errors to named, user-actionable HTTP errors. */
  private mapProductWriteError(e: any): never {
    if (e?.code === 'P2002') {
      const target = Array.isArray(e.meta?.target)
        ? e.meta.target.join(',')
        : String(e.meta?.target || '');
      if (target.includes('slug')) {
        throw new ConflictException('Slug already exists');
      }
      if (target.includes('sku')) {
        throw new ConflictException(
          'Variant SKU already in use — change the conflicting variant SKU and try again',
        );
      }
      throw new ConflictException('A unique value is already in use');
    }
    if (e?.code === 'P2003') {
      const raw = String(e.meta?.field_name || '');
      const friendly = raw.includes('categor')
        ? 'category'
        : raw.includes('brand')
          ? 'brand'
          : raw.includes('sizeChart') || raw.includes('size_chart')
            ? 'size chart'
            : raw.includes('warehouse')
              ? 'warehouse'
              : raw.includes('attribute')
                ? 'attribute value'
                : 'referenced record';
      throw new BadRequestException(
        `The selected ${friendly} no longer exists — refresh and pick it again`,
      );
    }
    if (e?.code === 'P2025') {
      throw new NotFoundException('Product not found');
    }
    throw e;
  }

  private async syncTags(tagNames: string[], productId: string): Promise<void> {
    const oldTags = await this.prisma.productTag.findMany({
      where: { productId },
      select: { tagId: true },
    });
    const oldTagIds = oldTags.map((t) => t.tagId);
    await this.prisma.productTag.deleteMany({ where: { productId } });
    if (oldTagIds.length > 0) {
      await this.prisma.tag.updateMany({
        where: { id: { in: oldTagIds } },
        data: { productCount: { decrement: 1 } },
      });
    }
    if (!tagNames?.length) return;
    for (const name of tagNames) {
      const slug = slugify(name);
      let tag = await this.prisma.tag.findUnique({ where: { slug } });
      if (tag) {
        await this.prisma.tag.update({
          where: { id: tag.id },
          data: { productCount: { increment: 1 } },
        });
      } else {
        tag = await this.prisma.tag.create({
          data: { name, slug, productCount: 1 },
        });
      }
      await this.prisma.productTag.upsert({
        where: { productId_tagId: { productId, tagId: tag.id } },
        update: {},
        create: { productId, tagId: tag.id },
      });
    }
  }

  /**
   * Recompute and persist Product.effectivePrice from the CURRENT stored
   * prices (PLP scale round). This is the single writer-side helper for
   * the column: every price-affecting mutation path that does not fold
   * the value into its own write (variant create/update/delete,
   * variant regeneration, CSV import) calls this after its write lands.
   * The write is skipped when the stored value already matches, so
   * price-neutral calls (e.g. a variant image edit) stay read-only.
   * Returns the computed value, or null when the product is gone.
   */
  async syncEffectivePrice(productId: string): Promise<number | null> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        type: true,
        basePrice: true,
        salePrice: true,
        effectivePrice: true,
      },
    });
    if (!product) return null;
    let variants: Array<{ price: any; salePrice: any }> = [];
    if (product.type === 'variable') {
      variants =
        (await this.prisma.productVariant.findMany({
          where: { productId },
          select: { price: true, salePrice: true },
        })) ?? [];
    }
    const value = computeEffectivePrice(product, variants);
    if (Number(product.effectivePrice) !== value) {
      await this.prisma.product.update({
        where: { id: productId },
        data: { effectivePrice: value },
      });
    }
    return value;
  }

  /**
   * Mode-switch cleanup (2026-11-11, directive §2): when a product leaves
   * MANAGED_STOCK, EVERY managed counter becomes 0 and every clearing is
   * written to ManagedStockLedger — for ALL signs, ALL types, on EVERY
   * save path (update, draft autosave, publish). This ONE helper is the
   * only implementation; the paths must never grow divergent copies.
   *
   * Per counter (simple/combo: the product row; variable: each variant):
   *   qty > 0 → OUT / ADJUSTMENT, quantity = qty, before → 0 (existing
   *             note wording kept verbatim);
   *   qty < 0 → IN / ADJUSTMENT, quantity = |qty|, stockBefore = the
   *             negative value → stockAfter 0 — the negative is visibly
   *             CLEARED, never left stranded and never sign-flipped;
   *   qty = 0 → a quantity-0 ADJUSTMENT note row (stockBefore 0 →
   *             stockAfter 0). The ledger schema represents this cleanly
   *             (quantity is a plain Int, stockBefore/After nullable), so
   *             the mode change itself stays auditable even when there
   *             was nothing to clear.
   * Quantities are read FRESH from the stored rows at call time (callers
   * invoke this AFTER their main update), so a draft whose variants were
   * wholesale-replaced in the same save is cleaned on its final values.
   */
  private async clearManagedStockForModeChange(params: {
    productId: string;
    fromMode: string;
    toMode: string;
    performedBy?: string;
  }): Promise<void> {
    const { productId, fromMode, toMode, performedBy } = params;
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { type: true, managedStockQuantity: true },
    });
    if (!product) return;

    const recordClearing = async (args: {
      variantId?: string;
      qty: number;
      variant: boolean;
    }) => {
      await this.prisma.managedStockLedger.create({
        data: {
          productId,
          ...(args.variantId ? { variantId: args.variantId } : {}),
          quantity: Math.abs(args.qty),
          direction: args.qty < 0 ? 'IN' : 'OUT',
          type: 'ADJUSTMENT',
          stockBefore: args.qty,
          stockAfter: 0,
          note: args.variant
            ? `Mode changed from ${fromMode} to ${toMode} — variant snapshot: ${args.qty} units`
            : `Mode changed from ${fromMode} to ${toMode} — snapshot: ${args.qty} units`,
          performedById: performedBy,
        },
      });
    };

    if (product.type === 'variable') {
      const variants =
        (await this.prisma.productVariant.findMany({
          where: { productId },
          select: { id: true, managedStockQuantity: true },
        })) ?? [];
      for (const v of variants) {
        const qty = v.managedStockQuantity ?? 0;
        await recordClearing({ variantId: v.id, qty, variant: true });
        if (qty !== 0) {
          await this.prisma.productVariant.update({
            where: { id: v.id },
            data: { managedStockQuantity: 0 },
          });
        }
      }
      if ((product.managedStockQuantity ?? 0) !== 0) {
        await this.prisma.product.update({
          where: { id: productId },
          data: { managedStockQuantity: 0 },
        });
      }
      return;
    }

    // simple + combo (a combo's own counter lives on the product row,
    // exactly like a simple product's — previously combo had NO cleanup
    // branch at all and its quantity survived the switch).
    const qty = product.managedStockQuantity ?? 0;
    await recordClearing({ qty, variant: false });
    if (qty !== 0) {
      await this.prisma.product.update({
        where: { id: productId },
        data: { managedStockQuantity: 0 },
      });
    }
  }

  private buildWhere(query: {
    search?: string;
    type?: string;
    categoryIds?: string[];
    isActive?: boolean;
    isFeatured?: boolean;
    ids?: string[];
    status?: 'active' | 'draft';
  }) {
    const where: any = {};
    const rawSearch = query.search?.trim();
    if (rawSearch) {
      const cleanSearch = rawSearch.startsWith('#') ? rawSearch.slice(1).trim() : rawSearch;
      where.OR = [
        { name: { contains: rawSearch, mode: 'insensitive' } },
        { slug: { contains: rawSearch, mode: 'insensitive' } },
        { sku: { contains: rawSearch, mode: 'insensitive' } },
        // Variant-level SKUs: many products carry their SKU on the variant
        // (Product.sku is nullable), so searching must also match those.
        {
          variants: {
            some: { sku: { contains: rawSearch, mode: 'insensitive' } },
          },
        },
      ];
      if (cleanSearch && cleanSearch !== rawSearch) {
        where.OR.push(
          { name: { contains: cleanSearch, mode: 'insensitive' } },
          { slug: { contains: cleanSearch, mode: 'insensitive' } },
          { sku: { contains: cleanSearch, mode: 'insensitive' } },
          {
            variants: {
              some: { sku: { contains: cleanSearch, mode: 'insensitive' } },
            },
          },
        );
      }
    }
    if (query.categoryIds && query.categoryIds.length > 0) {
      const catCondition = {
        OR: [
          { categoryId: { in: query.categoryIds } },
          {
            productCategories: {
              some: { categoryId: { in: query.categoryIds } },
            },
          },
        ],
      };
      if (where.AND) {
        where.AND.push(catCondition);
      } else {
        where.AND = [catCondition];
      }
    }
    if (query.type) where.type = query.type;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.isFeatured !== undefined) where.isFeatured = query.isFeatured;
    if (query.ids?.length) where.id = { in: query.ids };
    // Drafts are hidden from every listing unless explicitly requested.
    if (query.status === 'draft') where.status = 'draft';
    else if (query.status === 'active') where.status = 'active';
    else where.status = { not: 'draft' };
    return where;
  }

  async resolveCategorySlug(slug: string): Promise<string | undefined> {
    if (!slug) return undefined;
    const cat = await this.prisma.category.findUnique({
      where: { slug },
      select: { id: true },
    });
    return cat?.id;
  }

  async getCategoryWithDescendants(categoryId: string): Promise<string[]> {
    const ids = new Set<string>();
    ids.add(categoryId);
    let currentIds = [categoryId];
    while (currentIds.length > 0) {
      const children = await this.prisma.category.findMany({
        where: { parentId: { in: currentIds } },
        select: { id: true },
      });
      const childIds = children.map((c) => c.id).filter((id) => !ids.has(id));
      childIds.forEach((id) => ids.add(id));
      currentIds = childIds;
    }
    return Array.from(ids);
  }

  /**
   * Product ids with genuinely sellable stock, per each product's own
   * availabilityMode (owner rule): MANAGED_STOCK counts managed AVAILABLE
   * (quantity − reserved), INVENTORY_CONTROLLED counts physical AVAILABLE
   * across warehouses, ALWAYS_IN_STOCK always qualifies,
   * ALWAYS_OUT_OF_STOCK never does. "Quantity − reserved > 0" is a
   * cross-field comparison Prisma's where API cannot express, so the
   * hasStock filter resolves the matching id set via raw SQL (the same
   * technique the low-stock report already uses) and intersects it with
   * the caller's other filters.
   */
  private async findInStockProductIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT p.id
      FROM "Product" p
      WHERE p."availabilityMode" = 'ALWAYS_IN_STOCK'
         OR (p."availabilityMode" = 'MANAGED_STOCK' AND p.type <> 'variable'
             AND p."stock" - p."reservedStock" > 0)
         OR (p."availabilityMode" = 'MANAGED_STOCK' AND p.type = 'variable'
             AND EXISTS (SELECT 1 FROM "ProductVariant" v
                         WHERE v."productId" = p.id AND v."isActive" = true
                           AND v."stock" - v."reservedStock" > 0))
         OR (p."availabilityMode" = 'INVENTORY_CONTROLLED' AND p.type <> 'variable'
             AND EXISTS (SELECT 1 FROM "PhysicalInventory" pi
                         WHERE pi."productId" = p.id AND pi."variantId" IS NULL
                           AND pi."quantity" - pi."reservedQuantity" > 0))
         OR (p."availabilityMode" = 'INVENTORY_CONTROLLED' AND p.type = 'variable'
             AND EXISTS (SELECT 1 FROM "PhysicalInventory" pi
                         JOIN "ProductVariant" v ON v.id = pi."variantId"
                         WHERE pi."productId" = p.id AND v."isActive" = true
                           AND pi."quantity" - pi."reservedQuantity" > 0))
    `;
    return rows.map((r) => r.id);
  }

  private decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
    try {
      const raw = Buffer.from(cursor, 'base64url').toString('utf8');
      const [iso, id] = raw.split('|');
      if (!iso || !id) return null;
      const createdAt = new Date(iso);
      if (isNaN(createdAt.getTime())) return null;
      return { createdAt, id };
    } catch {
      return null;
    }
  }

  private encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString(
      'base64url',
    );
  }

  /**
   * Price-sort keyset cursor (PLP scale round): same base64url envelope
   * as the createdAt cursor, carrying the (effectivePrice, id) key of
   * the last row served. The price segment is validated as a plain
   * decimal so a createdAt cursor (or any foreign string) can never be
   * misread as a price key.
   */
  private decodePriceCursor(
    cursor: string,
  ): { price: number; id: string } | null {
    try {
      const raw = Buffer.from(cursor, 'base64url').toString('utf8');
      const [priceStr, id] = raw.split('|');
      if (!priceStr || !id) return null;
      if (!/^-?\d+(\.\d+)?$/.test(priceStr)) return null;
      const price = parseFloat(priceStr);
      if (isNaN(price)) return null;
      return { price, id };
    } catch {
      return null;
    }
  }

  private encodePriceCursor(price: unknown, id: string): string {
    return Buffer.from(`${Number(price)}|${id}`, 'utf8').toString('base64url');
  }

  private readonly listInclude = {
    brand: true,
    category: { select: { id: true, name: true, slug: true } },
    productCategories: {
      include: { category: { select: { id: true, name: true, slug: true } } },
    },
    variants: {
      include: {
        attributeValues: {
          select: {
            attributeValue: {
              select: {
                id: true,
                value: true,
                attribute: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    },
  };

  private readonly productInclude = {
    brand: true,
    category: { select: { id: true, name: true, slug: true } },
    productCategories: {
      include: { category: { select: { id: true, name: true, slug: true } } },
    },
    variants: {
      include: {
        attributeValues: {
          include: { attributeValue: { include: { attribute: true } } },
        },
      },
    },
  };

  /**
   * List page-size guard: an unbounded `take` with the full list include
   * (variants + attribute values + brand + categories + enrichments) turns one
   * page into a full-catalogue dump at thousands scale. 100 rows is the most
   * any list UI offers.
   */
  private static readonly LIST_MAX_PER_PAGE = 100;

  private clampListPerPage(perPage?: number, fallback = 24): number {
    if (!Number.isFinite(perPage as number) || (perPage as number) <= 0) return fallback;
    return Math.min(Math.floor(perPage as number), ProductsService.LIST_MAX_PER_PAGE);
  }

  // SECURITY (2026-10-25, F16): the public payload strips internal
  // fields — cost, managed/reserved stock components, warehouse routing
  // and sales counts. Staff callers (admin/POS, identified by the auth
  // guard on the shared list endpoint) keep the full payload. The
  // customer-facing availability signal, availableStock, is intentionally
  // kept: it is the number the PDP actually renders.
  private stripPublicProduct(p: any) {
    if (!p || typeof p !== 'object') return p;
    delete p.standardCost;
    delete p.managedStockQuantity;
    delete p.reservedStock;
    delete p.warehouseId;
    delete p.defaultBinLocationId;
    delete p._count;
    if (Array.isArray(p.variants)) {
      for (const v of p.variants) {
        delete v.standardCost;
        delete v.managedStockQuantity;
        delete v.reservedStock;
        delete v.warehouseId;
        delete v.binLocationId;
        delete v._count;
      }
    }
    return p;
  }

  /**
   * P2 (speed plan §5) — OPT-IN card projection for the public list.
   *
   * The shared list endpoint also serves authenticated admin consumers
   * (orders create, inventory, coupons — they need variants/stock/sku),
   * so the default response is UNCHANGED. A caller that only renders
   * product cards passes `fields=card` and gets the same rows slimmed
   * to card inputs, in the same raw shape the storefront transform
   * already consumes:
   *  - heavy content dropped: description HTML, shortDesc,
   *    descriptionSections, customizations, detailRows, videoUrl, seo;
   *  - gallery collapsed to the primary image;
   *  - variants collapsed to price/stock stubs (the storefront transform
   *    derives display price range + any-variant-in-stock from them,
   *    then drops them — attribute values/images never leave here);
   *  - `_mediaMeta` narrowed to the primary image's `small` derivative
   *    (the only derivative a card renders).
   * Applied AFTER stripPublicProduct, so the security strip still runs
   * first for non-staff callers.
   */
  private toCardProduct(p: any) {
    if (!p || typeof p !== 'object') return p;
    const images = Array.isArray(p.images) ? p.images : [];
    const primary = p.image || images[0];
    const meta = primary ? p._mediaMeta?.[primary] : undefined;
    const small = meta?.derivativeManifest?.small;
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      basePrice: p.basePrice,
      salePrice: p.salePrice,
      effectivePrice: p.effectivePrice,
      originalPrice: p.originalPrice,
      type: p.type,
      image: primary,
      images: primary ? [primary] : [],
      categoryId: p.categoryId,
      category: p.category,
      brand: p.brand ? { id: p.brand.id, name: p.brand.name, slug: p.brand.slug } : p.brand,
      isFeatured: p.isFeatured,
      isActive: p.isActive,
      sku: p.sku,
      tags: p.tags,
      availabilityMode: p.availabilityMode,
      manageStock: p.manageStock,
      codAvailable: p.codAvailable,
      availableStock: p.availableStock,
      averageRating: p.averageRating,
      rating: p.rating,
      _count: p._count,
      variants: Array.isArray(p.variants)
        ? p.variants.map((v: any) => ({
            id: v.id,
            price: v.price,
            salePrice: v.salePrice,
            isActive: v.isActive,
            availableStock: v.availableStock,
          }))
        : p.variants,
      _mediaMeta:
        primary && small
          ? {
              [primary]: {
                derivativeManifest: { small },
                blurUrl: null,
              },
            }
          : undefined,
    };
  }

  async findAll(query: {
    page?: number;
    perPage?: number;
    search?: string;
    type?: string;
    categoryId?: string;
    tagSlug?: string;
    brandSlug?: string;
    minPrice?: number;
    maxPrice?: number;
    isActive?: boolean;
    isFeatured?: boolean;
    ids?: string[];
    sort?: string;
    order?: string;
    cursor?: string;
    hasStock?: boolean;
    status?: 'active' | 'draft';
    fields?: string;
  }, opts?: { isStaff?: boolean }) {
    const rawPage = query.page || 1;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    const perPage = this.clampListPerPage(query.perPage);

    let categoryIds: string[] | undefined = undefined;
    if (query.categoryId) {
      categoryIds = await this.getCategoryWithDescendants(query.categoryId);
    }

    const where: any = this.buildWhere({ ...query, categoryIds });
    if (query.tagSlug) {
      where.productTags = {
        some: {
          tag: {
            slug: {
              equals: query.tagSlug,
              mode: 'insensitive',
            },
          },
        },
      };
    }
    if (query.brandSlug) {
      where.brand = {
        slug: {
          equals: query.brandSlug,
          mode: 'insensitive',
        },
      };
    }
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const priceFilter: any = {};
      if (query.minPrice !== undefined) priceFilter.gte = query.minPrice;
      if (query.maxPrice !== undefined) priceFilter.lte = query.maxPrice;
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            {
              type: { not: 'variable' },
              OR: [
                { salePrice: priceFilter },
                { salePrice: null, basePrice: priceFilter },
              ],
            },
            {
              type: 'variable',
              variants: {
                some: {
                  OR: [
                    { salePrice: priceFilter },
                    { salePrice: null, price: priceFilter },
                  ],
                },
              },
            },
          ],
        },
      ];
    }
    if (query.hasStock === true) {
      // AVAILABLE stock (quantity − reserved), per product mode — the old
      // OR clauses matched GROSS quantity, so a fully-reserved product
      // still counted as "in stock" even though it could not be sold.
      const inStockIds = await this.findInStockProductIds();
      where.AND = [
        ...(where.AND || []),
        { id: { in: inStockIds } },
      ];
    }
    // SECURITY (2026-10-25, F16): sort/order are allowlisted — the old
    // code used the raw query value as an orderBy key.
    const ALLOWED_SORTS = ['createdAt', 'basePrice', 'price', 'popularity', 'name'];
    if (query.sort && !ALLOWED_SORTS.includes(query.sort)) {
      query.sort = undefined;
    }
    if (query.order && query.order !== 'asc' && query.order !== 'desc') {
      query.order = undefined;
    }
    if (query.ids && query.ids.length > 200) query.ids = query.ids.slice(0, 200);

    let orderBy: any;
    if (query.sort === 'basePrice' || query.sort === 'price') {
      const dir = query.order === 'asc' ? 'asc' : 'desc';
      // PLP scale round: the price sort runs in Postgres on the
      // persisted effectivePrice column — this offset path serves the
      // admin lists (the storefront scroll rides the keyset cursor in
      // findAllCursor instead). Tie-break is id ASC in BOTH directions,
      // the exact order the retired in-memory sort produced (its
      // tie-break compared ids ascending regardless of direction).
      orderBy = [{ effectivePrice: dir }, { id: 'asc' }];
    } else if (query.sort === 'popularity') {
      orderBy = [
        { orderItems: { _count: query.order || 'desc' } },
        { id: 'desc' },
      ];
    } else {
      orderBy = [
        { [query.sort || 'createdAt']: query.order || 'desc' },
        { id: 'desc' },
      ];
    }

    // One DB-paged read for every sort (PLP scale round): price sorts
    // used to load ALL matching products + variants, sort in memory and
    // slice a page of ids — a full-catalogue read per PLP price-sort
    // request. The persisted effectivePrice column (orderBy above)
    // makes them ordinary indexed sorts like every other sort here.
    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy,
        include: this.listInclude,
      }),
      this.prisma.product.count({ where }),
    ]);

    await this.enrichProductsWithAvailableStock(data);
    await this.enrichWithDerivatives(data);
    if (!opts?.isStaff) data.forEach((p) => this.stripPublicProduct(p));
    const hasMore = page * perPage < total;
    const last = data[data.length - 1];
    const nextCursor = query.sort
      ? hasMore
        ? String(page + 1)
        : null
      : hasMore && last
        ? this.encodeCursor(last.createdAt, last.id)
        : null;
    return {
      data: query.fields === 'card' ? data.map((p) => this.toCardProduct(p)) : data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
        nextCursor,
        hasMore,
      },
    };
  }

  async findAllCursor(query: {
    cursor?: string;
    perPage?: number;
    search?: string;
    type?: string;
    categoryId?: string;
    category?: string;
    tagSlug?: string;
    brandSlug?: string;
    minPrice?: number;
    maxPrice?: number;
    isActive?: boolean;
    isFeatured?: boolean;
    ids?: string[];
    hasStock?: boolean;
    status?: 'active' | 'draft';
    fields?: string;
    sort?: string;
    order?: string;
  }, opts?: { isStaff?: boolean }) {
    const perPage = this.clampListPerPage(query.perPage);
    if (query.ids && query.ids.length > 200) query.ids = query.ids.slice(0, 200);
    // PLP scale round: price sorts join the keyset path on the
    // persisted (effectivePrice, id) key; every other call keeps the
    // (createdAt, id) newest-first keyset exactly as before. The id
    // tie-break is ASC in both price directions — the retired in-memory
    // sort compared ids ascending regardless of direction.
    const isPriceSort = query.sort === 'price' || query.sort === 'basePrice';
    const priceDir: 'asc' | 'desc' = query.order === 'asc' ? 'asc' : 'desc';
    const effectiveCategoryId =
      query.categoryId ||
      (query.category
        ? await this.resolveCategorySlug(query.category)
        : undefined);

    let categoryIds: string[] | undefined = undefined;
    if (effectiveCategoryId) {
      categoryIds = await this.getCategoryWithDescendants(effectiveCategoryId);
    }

    const filters = this.buildWhere({
      ...query,
      categoryIds,
    });
    if (query.tagSlug) {
      filters.productTags = {
        some: {
          tag: {
            slug: {
              equals: query.tagSlug,
              mode: 'insensitive',
            },
          },
        },
      };
    }
    if (query.brandSlug) {
      filters.brand = {
        slug: {
          equals: query.brandSlug,
          mode: 'insensitive',
        },
      };
    }
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const priceFilter: any = {};
      if (query.minPrice !== undefined) priceFilter.gte = query.minPrice;
      if (query.maxPrice !== undefined) priceFilter.lte = query.maxPrice;
      filters.AND = [
        ...(filters.AND || []),
        {
          OR: [
            {
              type: { not: 'variable' },
              OR: [
                { salePrice: priceFilter },
                { salePrice: null, basePrice: priceFilter },
              ],
            },
            {
              type: 'variable',
              variants: {
                some: {
                  OR: [
                    { salePrice: priceFilter },
                    { salePrice: null, price: priceFilter },
                  ],
                },
              },
            },
          ],
        },
      ];
    }
    if (query.hasStock === true) {
      // Same AVAILABLE-stock (quantity − reserved) rule as findAll.
      const inStockIds = await this.findInStockProductIds();
      filters.AND = [
        ...(filters.AND || []),
        { id: { in: inStockIds } },
      ];
    }
    const cursorWhere: any = { ...filters };
    const existingAnd = cursorWhere.AND?.length
      ? [...cursorWhere.AND]
      : undefined;
    if (query.cursor) {
      let cursorFilter: any = null;
      if (isPriceSort) {
        const decoded = this.decodePriceCursor(query.cursor);
        if (decoded) {
          cursorFilter = {
            OR: [
              priceDir === 'asc'
                ? { effectivePrice: { gt: decoded.price } }
                : { effectivePrice: { lt: decoded.price } },
              { effectivePrice: decoded.price, id: { gt: decoded.id } },
            ],
          };
        }
      } else {
        const decoded = this.decodeCursor(query.cursor);
        if (decoded) {
          cursorFilter = {
            OR: [
              { createdAt: { lt: decoded.createdAt } },
              { createdAt: decoded.createdAt, id: { lt: decoded.id } },
            ],
          };
        }
      }
      if (cursorFilter) {
        const conditions: any[] = [cursorFilter];
        if (cursorWhere.OR) {
          conditions.push({ OR: cursorWhere.OR });
          delete cursorWhere.OR;
        }
        if (existingAnd?.length) {
          conditions.push(...existingAnd);
        }
        cursorWhere.AND = conditions;
      }
    }
    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where: cursorWhere,
        take: perPage,
        orderBy: isPriceSort
          ? [{ effectivePrice: priceDir }, { id: 'asc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }],
        include: this.listInclude,
      }),
      this.prisma.product.count({ where: filters }),
    ]);
    await this.enrichProductsWithAvailableStock(data);
    await this.enrichWithDerivatives(data);
    if (!opts?.isStaff) data.forEach((p) => this.stripPublicProduct(p));
    const hasMore = data.length === perPage;
    const last = data[data.length - 1];
    const nextCursor =
      hasMore && last
        ? isPriceSort
          ? this.encodePriceCursor(last.effectivePrice, last.id)
          : this.encodeCursor(last.createdAt, last.id)
        : null;
    return {
      data: query.fields === 'card' ? data.map((p) => this.toCardProduct(p)) : data,
      meta: {
        total,
        perPage,
        nextCursor,
        hasMore,
      },
    };
  }

  async findBySlug(slug: string, opts?: { isStaff?: boolean }) {
    // SECURITY (2026-10-25, F16): the public slug endpoint serves only
    // ACTIVE products (an inactive/draft slug used to resolve), and the
    // cache is scoped by caller — a staff fetch must never poison the
    // public cache with the full payload, or vice versa.
    const cacheKey = `product:slug:${slug}:${opts?.isStaff ? 'staff' : 'public'}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;
    const product = await this.prisma.product.findUnique({
      where: { slug, isActive: true, status: { not: 'draft' } },
      include: {
        brand: true,
        category: true,
        variants: {
          include: {
            attributeValues: {
              include: {
                attributeValue: {
                  include: { attribute: true },
                },
              },
            },
          },
        },
        productCategories: { include: { category: true } },
        _count: { select: { orderItems: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    const enriched = (await this.enrichProductsWithAvailableStock([product]))[0];
    await this.enrichWithDerivatives([enriched]);
    await this.rewriteDescriptionImages(enriched);
    if (!opts?.isStaff) this.stripPublicProduct(enriched);
    // Short TTL: availableStock is baked into this payload, so the cache is
    // only a brief read amplifier. Every stock-mutating path invalidates
    // 'product:' explicitly; this 10s window is the safety net that bounds
    // staleness if a future write path forgets to invalidate.
    await this.cache.set(cacheKey, enriched, 10_000);
    return enriched;
  }

  async findOne(id: string) {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: {
        brand: { select: { id: true, name: true, slug: true } },
        category: true,
        productCategories: {
          include: {
            category: { select: { id: true, name: true, slug: true } },
          },
        },
        variants: {
          include: {
            attributeValues: {
              include: { attributeValue: { include: { attribute: true } } },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
        // Combos this product is a component of — the detail page's combo
        // card (bundle membership for simple/variable/combo products alike).
        comboItems: {
          include: {
            combo: { select: { id: true, name: true, slug: true, isActive: true } },
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Product not found');
    const enriched = (await this.enrichProductsWithAvailableStock([p]))[0];
    await this.enrichWithDerivatives([enriched]);
    return enriched;
  }

  async create(dto: CreateProductDto) {
    const existing = await this.prisma.product.findUnique({
      where: { slug: dto.slug },
      select: { id: true, status: true },
    });
    if (existing && existing.status !== 'draft')
      throw new ConflictException('Slug already exists');

    const categoryIds =
      dto.categoryIds || (dto.categoryId ? [dto.categoryId] : []);
    const categoryId = dto.categoryId || categoryIds[0] || null;

    // Smart default: an explicit availabilityMode is ALWAYS persisted as-is
    // (variable products included — they can legitimately be
    // ALWAYS_IN_STOCK / ALWAYS_OUT_OF_STOCK / INVENTORY_CONTROLLED). When
    // omitted: variable products default to MANAGED_STOCK (per-variant stock),
    // simple products default to INVENTORY_CONTROLLED when inventory
    // management is enabled, else MANAGED_STOCK.
    const avMode: string =
      dto.availabilityMode ||
      (dto.type === 'variable'
        ? 'MANAGED_STOCK'
        : dto.manageStock
          ? 'MANAGED_STOCK'
          : (await this.stockRouter.isInventoryManagementEnabled())
            ? 'INVENTORY_CONTROLLED'
            : 'MANAGED_STOCK');

    const scalars = {
      name: dto.name,
      slug: dto.slug,
      type: dto.type || 'simple',
      description: dto.description,
      shortDesc: dto.shortDesc,
      brandId: dto.brandId,
      basePrice: dto.basePrice,
      salePrice: dto.salePrice,
      // PLP scale round: the persisted sort price is computable from
      // the payload alone (variants are created 1:1 from dto.variants),
      // so it folds into this same write — no follow-up sync needed.
      // The draft-promote path below reuses `scalars`, so it is covered
      // by the same line.
      effectivePrice: computeEffectivePrice(
        {
          type: dto.type || 'simple',
          basePrice: dto.basePrice,
          salePrice: dto.salePrice,
        },
        dto.variants,
      ),
      sku: dto.sku,
      standardCost: dto.standardCost,
      managedStockQuantity:
        dto.type === 'variable' ? 0 : dto.managedStockQuantity || 0,
      lowStockQty: dto.lowStockQty,
      weightGram: dto.weightGram ?? null,
      customizations:
        dto.customizations === undefined
          ? undefined
          : this.normalizeCustomizations(dto.customizations),
      categoryId: categoryId || undefined,
      sizeChartId: dto.sizeChartId,
      tags: dto.tags as any,
      images: (dto.images || []) as any,
      seoMeta: dto.seoMeta,
      videoUrl: this.normalizeVideoUrl(dto.videoUrl),
      detailRows: dto.detailRows as any,
      descriptionSections: dto.descriptionSections as any,
      isFeatured: dto.isFeatured || false,
      availabilityMode: avMode as any,
      manageStock: avMode === 'MANAGED_STOCK',
      syncManagedStock: dto.syncManagedStock,
      warehouseId: dto.warehouseId,
    };

    const variantsCreate = dto.variants?.map((v, i) => ({
      sku: v.sku,
      sortOrder: v.sortOrder ?? i,
      price: v.price,
      salePrice: v.salePrice,
      standardCost: v.standardCost,
      managedStockQuantity: v.managedStockQuantity || 0,
      image: v.image,
      images: (v.images || []) as any,
      attributeValues: this.variantAttributeLinks(v.attributeValues),
    }));

    const include = {
      category: true,
      productCategories: {
        include: {
          category: { select: { id: true, name: true, slug: true } },
        },
      },
      variants: {
        include: {
          attributeValues: {
            include: { attributeValue: { include: { attribute: true } } },
          },
        },
        orderBy: { sortOrder: 'asc' as const },
      },
    };

    // A draft row produced by the create-dialog autosave (or a previous
    // session) may already hold the target slug/sku. Promote it in place
    // instead of colliding with it — the "create" becomes publishing the
    // session draft.
    const promote = async (id: string) =>
      this.prisma.product.update({
        where: { id },
        data: {
          ...scalars,
          isActive: dto.isActive ?? true,
          status: 'active',
          productCategories:
            categoryIds.length > 0
              ? {
                  deleteMany: {},
                  create: categoryIds.map((cid) => ({ categoryId: cid })),
                }
              : { deleteMany: {} },
          variants: dto.variants
            ? { deleteMany: {}, create: variantsCreate }
            : dto.type === 'simple'
              ? { deleteMany: {} }
              : undefined,
        },
        include,
      });

    await this.assertVariantSkusFree(dto.variants, existing?.id);

    let product;
    try {
      if (existing && existing.status === 'draft') {
        product = await promote(existing.id);
      } else {
        product = await this.prisma.product.create({
          data: {
            ...scalars,
            isActive: dto.isActive ?? true,
            productCategories:
              categoryIds.length > 0
                ? { create: categoryIds.map((cid) => ({ categoryId: cid })) }
                : undefined,
            variants: dto.variants
              ? { create: variantsCreate }
              : undefined,
          },
          include,
        });
      }
    } catch (e: any) {
      if (e.code === 'P2002') {
        // Product SKU is NOT unique, so a P2002 with a KNOWN target is
        // either a slug race (promote the draft holding that slug) or a
        // variant-SKU collision (named 409, never a draft promotion —
        // promoting by product SKU here once overwrote UNRELATED drafts
        // whose main SKU merely coincided). Real Prisma always sets
        // meta.target; the target-less branch keeps the legacy autosave
        // adopt path for errors that carry no target.
        const target = Array.isArray(e.meta?.target)
          ? e.meta.target.join(',')
          : String(e.meta?.target || '');
        if (target.includes('slug')) {
          const slugHolder = await this.prisma.product.findFirst({
            where: { slug: dto.slug, status: 'draft' },
            select: { id: true },
          });
          if (slugHolder) {
            product = await promote(slugHolder.id);
          } else {
            throw new ConflictException('Slug already exists');
          }
        } else if (!target) {
          const skuHolder = await this.prisma.product.findFirst({
            where: { sku: dto.sku, status: 'draft' },
            select: { id: true },
          });
          if (skuHolder) {
            product = await promote(skuHolder.id);
          } else {
            throw new ConflictException('SKU already in use');
          }
        } else {
          throw new ConflictException(
            'Variant SKU already in use — change the conflicting variant SKU and try again',
          );
        }
      } else {
        throw e;
      }
    }

    // The promote path can KEEP a draft's stored variants when the
    // payload carries none (variable draft promoted without a variant
    // list) — the scalars-folded value assumed the payload's variants,
    // so re-derive from stored state. A no-op (no write) whenever the
    // folded value already matches, which is every fresh create.
    await this.syncEffectivePrice(product.id);

    await this.syncTags(dto.tags || [], product.id);
    await this.cache.invalidateByPrefix('product:');

    if (
      avMode === 'MANAGED_STOCK' &&
      dto.type !== 'variable' &&
      (dto.managedStockQuantity ?? 0) > 0
    ) {
      await this.prisma.managedStockLedger.create({
        data: {
          productId: product.id,
          quantity: dto.managedStockQuantity ?? 0,
          direction: 'IN',
          type: 'INITIAL',
          stockBefore: 0,
          stockAfter: dto.managedStockQuantity ?? 0,
          note: 'Initial stock on product creation',
        },
      });
    }

    if (dto.images?.length) {
      const synced = await this.media.syncEntityImages(
        'product',
        product.id,
        dto.images,
      );
      if (JSON.stringify(synced) !== JSON.stringify(dto.images)) {
        await this.prisma.product.update({
          where: { id: product.id },
          data: { images: synced as any },
        });
        product.images = synced;
      }
    }

    if (dto.variants?.length) {
      for (const variant of product.variants) {
        const variantImages = ((variant as any).images as string[]) || [];
        if (variant.image && !variantImages.includes(variant.image)) {
          variantImages.unshift(variant.image);
        }
        if (variantImages.length > 0) {
          await this.media.syncEntityImages('variant', variant.id, variantImages);
        }
      }
    }

    // No initial-stock mirror (2026-11-11): creating a product writes
    // ONLY its managed counter; physical stock enters exclusively
    // through physical entry points, so creation also succeeds with no
    // warehouse anywhere.
    return product;
  }

  async update(id: string, dto: UpdateProductDto, performedBy?: string) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    // Same rule as updateDraft: a usable provided slug wins (with the
    // usual conflict check); an invalid stored slug regenerates on save
    // instead of persisting; a valid stored slug never changes.
    const resolvedSlug = await this.resolveUpdateSlug(dto, p);
    const data: any = { ...dto };
    if (dto.customizations !== undefined) {
      data.customizations = this.normalizeCustomizations(dto.customizations);
    }
    if (dto.tags) data.tags = dto.tags as any;
    if (dto.images !== undefined) data.images = dto.images as any;
    if (dto.seoMeta) data.seoMeta = dto.seoMeta;
    if (dto.videoUrl !== undefined) {
      data.videoUrl = this.normalizeVideoUrl(dto.videoUrl);
    }
    delete data.variants;
    delete data.attributes;
    delete data.categoryIds;
    if (resolvedSlug) data.slug = resolvedSlug;
    else delete data.slug;
    if (p.status === 'draft') {
      data.isActive = false;
      delete data.status;
    }

    if (p.type === 'variable' || p.type === 'combo') {
      delete data.managedStockQuantity;
      delete data.manageStock;
    } else {
      if (dto.managedStockQuantity !== undefined && dto.managedStockQuantity !== p.managedStockQuantity) {
        throw new BadRequestException(
          'Product stock cannot be edited directly. Use Inventory > Adjust Stock to change stock levels.',
        );
      }
      if (dto.availabilityMode) {
        data.manageStock = dto.availabilityMode === 'MANAGED_STOCK';
      }
    }
    // INVARIANT (2026-10-27): the managed engine gates on Product.manageStock
    // (adjust guard, order reserve, deduct, restore), while the storefront and
    // the adjustment dialog gate on availabilityMode. A MANAGED_STOCK product
    // with manageStock=false — written by CSV import for every variable
    // product and every 0-stock simple product, and stranded because the
    // variable carve-out above deleted manageStock from updates — could never
    // be managed-adjusted, reserved, or deducted, and no UI action could
    // repair it. Mode wins: a MANAGED_STOCK product always tracks stock, so
    // any edit-save repairs the flag. (Non-MANAGED modes leave manageStock
    // untouched — forcing it false could break combo components that rely
    // on it.)
    const effectiveMode = dto.availabilityMode ?? p.availabilityMode;
    if (effectiveMode === 'MANAGED_STOCK') {
      data.manageStock = true;
    }

    // PLP scale round: fold the persisted sort price into this same
    // write. update() never touches variant rows, so a recompute is
    // only needed when a price input changed; it uses the merged
    // scalars plus the CURRENT variant prices for a variable product.
    if (
      dto.basePrice !== undefined ||
      dto.salePrice !== undefined ||
      dto.type !== undefined
    ) {
      const nextType = dto.type ?? p.type;
      let priceVariants: Array<{ price: any; salePrice: any }> = [];
      if (nextType === 'variable') {
        priceVariants =
          (await this.prisma.productVariant.findMany({
            where: { productId: id },
            select: { price: true, salePrice: true },
          })) ?? [];
      }
      data.effectivePrice = computeEffectivePrice(
        {
          type: nextType,
          basePrice: dto.basePrice ?? p.basePrice,
          salePrice: dto.salePrice !== undefined ? dto.salePrice : p.salePrice,
        },
        priceVariants,
      );
    }

    if (dto.categoryIds !== undefined) {
      data.categoryId = dto.categoryIds[0] || null;
      data.productCategories = {
        deleteMany: {},
        create: dto.categoryIds.map((cid) => ({ categoryId: cid })),
      };
    } else if (dto.categoryId !== undefined) {
      data.categoryId = dto.categoryId;
      data.productCategories = {
        deleteMany: {},
        create: dto.categoryId ? [{ categoryId: dto.categoryId }] : [],
      };
    }

    const product = await this.prisma.product.update({
      where: { id },
      data,
      include: {
        brand: { select: { id: true, name: true, slug: true } },
        category: true,
        productCategories: {
          include: {
            category: { select: { id: true, name: true, slug: true } },
          },
        },
        variants: {
          include: {
            attributeValues: {
              include: { attributeValue: { include: { attribute: true } } },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (dto.tags !== undefined) {
      await this.syncTags(dto.tags || [], id);
    }

    if (dto.images !== undefined) {
      const synced = await this.media.syncEntityImages(
        'product',
        id,
        dto.images || [],
      );
      if (JSON.stringify(synced) !== JSON.stringify(dto.images || [])) {
        await this.prisma.product.update({
          where: { id },
          data: { images: synced as any },
        });
        product.images = synced;
      }
    }

    const newMode: string | undefined =
      dto.availabilityMode ??
      (dto.manageStock !== undefined
        ? dto.manageStock
          ? 'MANAGED_STOCK'
          : await this.stockRouter.isInventoryManagementEnabled()
            ? 'INVENTORY_CONTROLLED'
            : 'MANAGED_STOCK'
        : undefined);

    if (newMode && newMode !== p.availabilityMode) {
      if (newMode === 'MANAGED_STOCK') {
        if (p.type !== 'variable' && p.type !== 'combo') {
          const qty = dto.managedStockQuantity ?? p.managedStockQuantity;
          await this.prisma.managedStockLedger.create({
            data: {
              productId: id,
              quantity: qty,
              direction: 'IN',
              type: 'INITIAL',
              stockBefore: 0,
              stockAfter: qty,
              note: `Mode changed to MANAGED_STOCK — initial balance ${qty}`,
              performedById: performedBy,
            },
          });
        }
      } else if (p.availabilityMode === 'MANAGED_STOCK') {
        await this.clearManagedStockForModeChange({
          productId: id,
          fromMode: p.availabilityMode,
          toMode: newMode,
          performedBy,
        });
      }
    }

    await this.cache.invalidateByPrefix('product:');
    return product;
  }

  async remove(id: string) {
    await this.prisma.product.findUniqueOrThrow({ where: { id } });
    await this.prisma.comboItem.deleteMany({ where: { productId: id } });
    const variants = await this.prisma.productVariant.findMany({
      where: { productId: id },
      select: { id: true },
    });
    await Promise.all(
      variants.map((v) => this.media.detachAll('variant', v.id)),
    );
    await this.media.detachAll('product', id);
    await this.cache.invalidateByPrefix('product:');
    try {
      await this.prisma.product.delete({ where: { id } });
    } catch (e: any) {
      if (e.code === 'P2003') {
        throw new BadRequestException(
          'Cannot delete product with existing orders. Archive it instead.',
        );
      }
      throw e;
    }
    return { message: 'Product deleted' };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Persistent product drafts
  //
  // Drafts are REAL product records: status='draft', isActive=false, so
  // they are fully editable, listable and recoverable, yet never visible
  // to storefront queries (all of which filter isActive: true). A draft
  // only goes live through an explicit publish that validates the data.
  // ─────────────────────────────────────────────────────────────────────

  /**
   * A slug with no latin letter or digit is not a usable slug: a
   * Bengali-only name derives "-" from the latin-only regex, and "-"
   * is truthy, so every `slug || fallback` chain silently keeps it.
   * Such values are treated as EMPTY so the fallback chain triggers.
   */
  private usableSlug(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed && /[a-z0-9]/.test(trimmed) ? trimmed : null;
  }

  /** Latin-only slug derivation (same regex as the admin form). */
  private slugifyLatin(value: string | null | undefined): string | null {
    if (!value) return null;
    const slug = value
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    return /[a-z0-9]/.test(slug) ? slug : null;
  }

  /**
   * Resolve the slug an UPDATE actually stores, for update() and
   * updateDraft(). Fallback order: the provided slug (when usable, with
   * the usual conflict check) → the STORED slug, untouched, when it is
   * valid → regenerated from the name → SKU → draft-uuid fallback when
   * the stored slug itself is empty or has no alphanumeric character
   * (e.g. "-" from a pre-fix Bengali-only draft). A valid slug NEVER
   * changes on save; only invalid ones regenerate — an invalid slug
   * carries no meaningful inbound link, so regenerating it breaks
   * nothing. Returns null when the stored slug stays (caller must not
   * send a slug key at all in that case).
   */
  private async resolveUpdateSlug(
    dto: { slug?: string | null; name?: string | null; sku?: string | null },
    p: { slug: string | null; name?: string | null; sku?: string | null },
  ): Promise<string | null> {
    const provided = this.usableSlug(dto.slug);
    if (provided) {
      if (provided !== p.slug) {
        const exists = await this.prisma.product.findUnique({
          where: { slug: provided },
        });
        if (exists) throw new ConflictException('Slug already exists');
      }
      return provided;
    }
    if (this.usableSlug(p.slug)) return null;
    return this.ensureUniqueSlug(
      this.slugifyLatin(dto.name ?? p.name) ??
        this.slugifyLatin(dto.sku ?? p.sku) ??
        `draft-${randomUUID().slice(0, 8)}`,
    );
  }

  /**
   * Map a variant payload's attribute links, dropping id-less rows: a
   * variant row without attributeValueIds (manually added rows, old
   * duplicate clones) must never reach Prisma — an undefined id fails
   * validation and an empty create set is rejected, both surfacing as
   * a bare 500. A variant with no ids keeps no attribute links.
   */
  private variantAttributeLinks(
    attributeValues: Array<{ attributeValueId?: string }> | undefined,
  ): { create: Array<{ attributeValueId: string }> } | undefined {
    if (!attributeValues?.length) return undefined;
    const ids = attributeValues
      .map((av) => av?.attributeValueId)
      .filter((id): id is string => !!id);
    return ids.length > 0
      ? { create: ids.map((attributeValueId) => ({ attributeValueId })) }
      : undefined;
  }

  private async ensureUniqueSlug(base: string): Promise<string> {
    const exists = await this.prisma.product.findUnique({
      where: { slug: base },
    });
    if (!exists) return base;
    let i = 2;
    while (
      await this.prisma.product.findUnique({
        where: { slug: `${base}-${i}` },
      })
    ) {
      i++;
    }
    return `${base}-${i}`;
  }

  private draftAvailabilityMode(dto: {
    availabilityMode?: string;
    type?: string;
    manageStock?: boolean;
  }): Promise<string> {
    return Promise.resolve(
      dto.availabilityMode ||
        (dto.type === 'variable'
          ? 'MANAGED_STOCK'
          : dto.manageStock
            ? 'MANAGED_STOCK'
            : null),
    ).then((pre) =>
      pre
        ? pre
        : this.stockRouter.isInventoryManagementEnabled().then((im) =>
            im ? 'INVENTORY_CONTROLLED' : 'MANAGED_STOCK',
          ),
    );
  }

  /** Create a NEW independent draft record (one per form session). */
  async createDraft(dto: UpdateProductDto) {
    const slug = await this.ensureUniqueSlug(
      this.usableSlug(dto.slug) ??
        this.slugifyLatin(dto.sku) ??
        `draft-${randomUUID().slice(0, 8)}`,
    );
    const avMode = await this.draftAvailabilityMode({
      availabilityMode: dto.availabilityMode,
      type: dto.type,
      manageStock: dto.manageStock,
    });
    const categoryIds =
      dto.categoryIds || (dto.categoryId ? [dto.categoryId] : []);
    const categoryId = dto.categoryId || categoryIds[0] || null;

    await this.assertVariantSkusFree(dto.variants);

    let product: any;
    try {
    product = await this.prisma.product.create({
      data: {
        name: dto.name?.trim() || 'Untitled Draft',
        slug,
        type: dto.type || 'simple',
        description: dto.description,
        shortDesc: dto.shortDesc,
        basePrice: dto.basePrice ?? 0,
        salePrice: dto.salePrice,
        // PLP scale round: folded into the create write, same rule as
        // create() (drafts stay invisible to the PLP, but the column is
        // never left stale for the publish that follows).
        effectivePrice: computeEffectivePrice(
          {
            type: dto.type || 'simple',
            basePrice: dto.basePrice ?? 0,
            salePrice: dto.salePrice,
          },
          dto.variants,
        ),
        sku: dto.sku,
        brandId: dto.brandId || undefined,
        standardCost: dto.standardCost,
        managedStockQuantity:
          dto.type === 'variable' ? 0 : dto.managedStockQuantity || 0,
        lowStockQty: dto.lowStockQty,
        // The draft flow is how the admin form first persists a product —
        // weight (Q12) and the customization definition (Q15) must survive
        // it, not just the direct create path.
        weightGram: dto.weightGram ?? null,
        customizations:
          dto.customizations === undefined
            ? undefined
            : this.normalizeCustomizations(dto.customizations),
        categoryId: categoryId || undefined,
        productCategories:
          categoryIds.length > 0
            ? { create: categoryIds.map((cid) => ({ categoryId: cid })) }
            : undefined,
        sizeChartId: dto.sizeChartId,
        tags: dto.tags as any,
        images: (dto.images || []) as any,
        seoMeta: dto.seoMeta,
        videoUrl: this.normalizeVideoUrl(dto.videoUrl),
        detailRows: dto.detailRows as any,
        descriptionSections: dto.descriptionSections as any,
        isFeatured: dto.isFeatured || false,
        isActive: false,
        status: 'draft',
        availabilityMode: avMode as any,
        manageStock: avMode === 'MANAGED_STOCK',
        syncManagedStock: dto.syncManagedStock,
        warehouseId: dto.warehouseId,
        variants: dto.variants
          ? {
              create: dto.variants.map((v, i) => ({
                sku: v.sku,
                sortOrder: v.sortOrder ?? i,
                price: v.price,
                salePrice: v.salePrice,
                standardCost: v.standardCost,
                managedStockQuantity: v.managedStockQuantity || 0,
                image: v.image,
                images: (v.images || []) as any,
                attributeValues:
                  this.variantAttributeLinks(v.attributeValues),
              })),
            }
          : undefined,
      },
      include: {
        category: true,
        productCategories: {
          include: {
            category: { select: { id: true, name: true, slug: true } },
          },
        },
        variants: {
          include: {
            attributeValues: {
              include: { attributeValue: { include: { attribute: true } } },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    } catch (e) {
      this.mapProductWriteError(e);
    }

    if (product.variants?.length) {
      for (const variant of product.variants) {
        const variantImages = ((variant as any).images as string[]) || [];
        if (variant.image && !variantImages.includes(variant.image)) {
          variantImages.unshift(variant.image);
        }
        if (variantImages.length > 0) {
          await this.media.syncEntityImages(
            'variant',
            variant.id,
            variantImages,
          );
        }
      }
    }

    await this.syncTags(dto.tags || [], product.id);
    await this.cache.invalidateByPrefix('product:');
    return product;
  }

  /** Autosave: update the SAME draft record. Scalars only; stays a draft. */
  async updateDraft(id: string, dto: UpdateProductDto) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    if (p.status !== 'draft') {
      throw new BadRequestException(
        'Only draft products can be saved with the draft endpoint',
      );
    }
    await this.assertVariantSkusFree(dto.variants, id);
    // A no-alphanumeric slug (e.g. "-" from a Bengali-only name) is
    // treated as not provided — and when the STORED slug itself is
    // invalid, the save regenerates it instead of persisting "-" forever
    // (see resolveUpdateSlug: a valid stored slug never changes).
    const resolvedSlug = await this.resolveUpdateSlug(dto, p);

    const data: any = { ...dto };
    if (dto.customizations !== undefined) {
      data.customizations = this.normalizeCustomizations(dto.customizations);
    }
    if (dto.tags) data.tags = dto.tags as any;
    if (dto.images !== undefined) data.images = dto.images as any;
    if (dto.seoMeta) data.seoMeta = dto.seoMeta;
    if (dto.videoUrl !== undefined) {
      data.videoUrl = this.normalizeVideoUrl(dto.videoUrl);
    }
    delete data.attributes;
    delete data.status;
    delete data.isActive;
    // DTO-only keys must never reach Prisma: update() deletes
    // categoryIds, but updateDraft did not, so the form's always-sent
    // categoryIds arrived as an unknown argument → Prisma validation
    // error → rethrown raw by mapProductWriteError → bare 500. The
    // mocked suite never caught it (mocks accept any data).
    delete data.categoryIds;
    if (resolvedSlug) data.slug = resolvedSlug;
    else delete data.slug;

    if (dto.variants) {
      // Autosave carries the generated variant set — replace it wholesale so
      // variations never get lost between the form and the stored draft.
      data.variants = {
        deleteMany: {},
        create: dto.variants.map((v, i) => ({
          sku: v.sku,
          sortOrder: v.sortOrder ?? i,
          price: v.price,
          salePrice: v.salePrice,
          standardCost: v.standardCost,
          managedStockQuantity: v.managedStockQuantity || 0,
          image: v.image,
          images: (v.images || []) as any,
          attributeValues: this.variantAttributeLinks(v.attributeValues),
        })),
      };
    } else if (dto.type === 'simple') {
      // Switched back to a simple product — drop stale variant rows.
      data.variants = { deleteMany: {} };
    } else {
      delete data.variants;
    }

    if (dto.categoryIds !== undefined) {
      data.categoryId = dto.categoryIds[0] || null;
      data.productCategories = {
        deleteMany: {},
        create: dto.categoryIds.map((cid) => ({ categoryId: cid })),
      };
    } else if (dto.categoryId !== undefined) {
      data.categoryId = dto.categoryId;
      data.productCategories = {
        deleteMany: {},
        create: dto.categoryId ? [{ categoryId: dto.categoryId }] : [],
      };
    }

    const newMode = dto.availabilityMode
      ? dto.availabilityMode
      : dto.manageStock !== undefined
        ? dto.manageStock
          ? 'MANAGED_STOCK'
          : await this.stockRouter.isInventoryManagementEnabled()
            ? 'INVENTORY_CONTROLLED'
            : 'MANAGED_STOCK'
        : undefined;
    if (newMode && newMode !== p.availabilityMode) {
      data.availabilityMode = newMode;
      data.manageStock = newMode === 'MANAGED_STOCK';
    }

    // PLP scale round: fold the persisted sort price into this same
    // write. The post-write variant set is known exactly: the payload's
    // set when provided (wholesale replace above), none when the draft
    // switched back to simple, otherwise the stored rows (untouched by
    // this write), which are read only for a variable draft.
    {
      const nextType = dto.type ?? p.type;
      let priceVariants: Array<{ price?: any; salePrice?: any }> = [];
      if (dto.variants) {
        priceVariants = dto.variants;
      } else if (nextType === 'variable') {
        priceVariants =
          (await this.prisma.productVariant.findMany({
            where: { productId: id },
            select: { price: true, salePrice: true },
          })) ?? [];
      }
      data.effectivePrice = computeEffectivePrice(
        {
          type: nextType,
          basePrice: dto.basePrice ?? p.basePrice,
          salePrice: dto.salePrice !== undefined ? dto.salePrice : p.salePrice,
        },
        priceVariants,
      );
    }

    let product: any;
    try {
      product = await this.prisma.product.update({
      where: { id },
      data,
      include: {
        brand: { select: { id: true, name: true, slug: true } },
        category: true,
        productCategories: {
          include: {
            category: { select: { id: true, name: true, slug: true } },
          },
        },
        variants: {
          include: {
            attributeValues: {
              include: { attributeValue: { include: { attribute: true } } },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    } catch (e) {
      this.mapProductWriteError(e);
    }

    // Post-update steps used to run outside any error mapping, so a
    // failure here surfaced as a bare 500 even when Prisma named the
    // cause. Map them like the main write.
    try {
      if (dto.tags !== undefined) {
        await this.syncTags(dto.tags || [], id);
      }
      if (dto.images !== undefined) {
        const synced = await this.media.syncEntityImages(
          'product',
          id,
          dto.images || [],
        );
        if (JSON.stringify(synced) !== JSON.stringify(dto.images || [])) {
          await this.prisma.product.update({
            where: { id },
            data: { images: synced as any },
          });
        }
      }

      if (product.variants?.length) {
        for (const variant of product.variants) {
          const variantImages = ((variant as any).images as string[]) || [];
          if (variant.image && !variantImages.includes(variant.image)) {
            variantImages.unshift(variant.image);
          }
          if (variantImages.length > 0) {
            await this.media.syncEntityImages(
              'variant',
              variant.id,
              variantImages,
            );
          }
        }
      }
      // Mode-switch cleanup on the draft path too (2026-11-11): leaving
      // MANAGED_STOCK in an autosave clears + ledgers every managed
      // counter via the SAME helper update() uses. Runs after the main
      // update (incl. any wholesale variant replacement), so it reads
      // the final stored quantities. performedBy is not threaded into
      // the draft endpoints, so the ledger actor stays unset here.
      if (
        p.availabilityMode === 'MANAGED_STOCK' &&
        newMode &&
        newMode !== 'MANAGED_STOCK' &&
        newMode !== p.availabilityMode
      ) {
        await this.clearManagedStockForModeChange({
          productId: id,
          fromMode: p.availabilityMode,
          toMode: newMode,
        });
      }
      await this.cache.invalidateByPrefix('product:');
    } catch (e) {
      this.mapProductWriteError(e);
    }
    return product;
  }

  /** Publish: validate completeness, then activate the draft. */
  async publishDraft(id: string, dto: UpdateProductDto) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    if (p.status !== 'draft') {
      throw new BadRequestException('Product is not a draft');
    }
    await this.assertVariantSkusFree(dto.variants, id);

    const name = (dto.name?.trim() || p.name || '').trim();
    if (!name || name === 'Untitled Draft') {
      throw new BadRequestException(
        'Product name is required before publishing',
      );
    }
    const basePrice = Number(dto.basePrice ?? p.basePrice) || 0;
    if (basePrice <= 0) {
      throw new BadRequestException(
        'A positive base price is required before publishing',
      );
    }
    const salePrice = dto.salePrice ?? p.salePrice;
    if (salePrice != null && Number(salePrice) > basePrice) {
      throw new BadRequestException(
        'Sale price cannot exceed the base price before publishing',
      );
    }
    const finalTypeForValidation = dto.type || p.type;
    const variantCountForValidation =
      finalTypeForValidation === 'variable'
        ? dto.variants
          ? dto.variants.length
          : await this.prisma.productVariant.count({ where: { productId: id } })
        : 0;
    if (finalTypeForValidation === 'variable' && variantCountForValidation === 0) {
      throw new BadRequestException(
        'A variable product needs at least one variant before publishing',
      );
    }

    const dtoSlug = this.usableSlug(dto.slug);
    const slug =
      dtoSlug && dtoSlug !== p.slug
        ? await this.ensureUniqueSlug(dtoSlug)
        : this.usableSlug(p.slug)
          ? p.slug
          : await this.ensureUniqueSlug(
              // Full rule order for a regenerated slug: name → SKU →
              // draft-uuid fallback (a Bengali-only name yields nothing
              // usable, so it falls through to the SKU like before).
              this.slugifyLatin(name) ??
                this.slugifyLatin(dto.sku ?? p.sku) ??
                `draft-${randomUUID().slice(0, 8)}`,
            );

    const data: any = { ...dto };
    if (dto.customizations !== undefined) {
      data.customizations = this.normalizeCustomizations(dto.customizations);
    }
    if (dto.tags) data.tags = dto.tags as any;
    if (dto.images !== undefined) data.images = dto.images as any;
    if (dto.seoMeta) data.seoMeta = dto.seoMeta;
    if (dto.videoUrl !== undefined) {
      data.videoUrl = this.normalizeVideoUrl(dto.videoUrl);
    }
    delete data.attributes;
    delete data.categoryIds;

    if (dto.categoryIds !== undefined) {
      data.categoryId = dto.categoryIds[0] || null;
      data.productCategories = {
        deleteMany: {},
        create: dto.categoryIds.map((cid) => ({ categoryId: cid })),
      };
    } else if (dto.categoryId !== undefined) {
      data.categoryId = dto.categoryId;
      data.productCategories = {
        deleteMany: {},
        create: dto.categoryId ? [{ categoryId: dto.categoryId }] : [],
      };
    }

    // Row Publish sends only { name } — default to the draft's STORED mode
    // instead of recomputing from the IM default, or an ALWAYS_IN_STOCK
    // draft would publish as MANAGED/INVENTORY_CONTROLLED with qty 0.
    const newMode = await this.draftAvailabilityMode({
      availabilityMode: dto.availabilityMode ?? p.availabilityMode,
      type: dto.type || p.type,
      manageStock: dto.manageStock,
    });
    data.availabilityMode = newMode;
    data.manageStock = newMode === 'MANAGED_STOCK';
    data.name = name;
    data.basePrice = basePrice;
    data.slug = slug;
    data.status = 'active';
    data.isActive = true;

    // No initial-stock mirror on publish either (2026-11-11): the
    // physical layer is entered only through physical entry points.
    const finalType = dto.type || p.type;
    // Stored variants of a variable draft published WITHOUT a payload
    // variant set: one read feeds both the initial-stock sum below and
    // the effectivePrice fold (prices added to the select for that).
    let publishStoredVariants: Array<{
      managedStockQuantity: number;
      price: any;
      salePrice: any;
    }> = [];
    if (finalType === 'variable' && !dto.variants) {
      publishStoredVariants =
        (await this.prisma.productVariant.findMany({
          where: { productId: id },
          select: { managedStockQuantity: true, price: true, salePrice: true },
        })) ?? [];
    }
    let initialStock: number;
    if (finalType === 'variable') {
      initialStock = dto.variants
        ? dto.variants.reduce(
            (sum, v) => sum + (v.managedStockQuantity ?? 0),
            0,
          )
        : publishStoredVariants.reduce(
            (sum, v) => sum + (v.managedStockQuantity ?? 0),
            0,
          );
    } else {
      initialStock = dto.managedStockQuantity ?? p.managedStockQuantity ?? 0;
    }

    if (dto.variants) {
      data.variants = {
        deleteMany: {},
        create: dto.variants.map((v, i) => ({
          sku: v.sku,
          sortOrder: v.sortOrder ?? i,
          price: v.price,
          salePrice: v.salePrice,
          standardCost: v.standardCost,
          managedStockQuantity: v.managedStockQuantity || 0,
          image: v.image,
          images: (v.images || []) as any,
          attributeValues: this.variantAttributeLinks(v.attributeValues),
        })),
      };
    }

    // PLP scale round: fold the persisted sort price into the publish
    // write, from the already-resolved final scalars (basePrice and
    // salePrice locals above) and the post-publish variant set.
    data.effectivePrice = computeEffectivePrice(
      { type: finalType, basePrice, salePrice },
      dto.variants ?? publishStoredVariants,
    );

    let product: any;
    try {
      product = await this.prisma.product.update({
      where: { id },
      data,
      include: {
        brand: { select: { id: true, name: true, slug: true } },
        category: true,
        productCategories: {
          include: {
            category: { select: { id: true, name: true, slug: true } },
          },
        },
        variants: {
          include: {
            attributeValues: {
              include: { attributeValue: { include: { attribute: true } } },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    } catch (e) {
      this.mapProductWriteError(e);
    }

    // Same post-update error mapping as updateDraft: a failure here
    // must surface as a named error, not a bare 500.
    try {
      if (dto.tags !== undefined) {
        await this.syncTags(dto.tags || [], id);
      }
      if (dto.images !== undefined) {
        const synced = await this.media.syncEntityImages(
          'product',
          id,
          dto.images || [],
        );
        if (JSON.stringify(synced) !== JSON.stringify(dto.images || [])) {
          await this.prisma.product.update({
            where: { id },
            data: { images: synced as any },
          });
        }
      }

      if (product.variants?.length) {
        for (const variant of product.variants) {
          const variantImages = ((variant as any).images as string[]) || [];
          if (variant.image && !variantImages.includes(variant.image)) {
            variantImages.unshift(variant.image);
          }
          if (variantImages.length > 0) {
            await this.media.syncEntityImages(
              'variant',
              variant.id,
              variantImages,
            );
          }
        }
      }

      // Mode-switch cleanup on the publish path (2026-11-11): a draft
      // stored as MANAGED_STOCK that publishes into another mode gets
      // the same clear + ledger treatment as update()/updateDraft().
      if (p.availabilityMode === 'MANAGED_STOCK' && newMode !== 'MANAGED_STOCK') {
        await this.clearManagedStockForModeChange({
          productId: id,
          fromMode: p.availabilityMode,
          toMode: newMode,
        });
      }


      // Creation-equivalent ledger entry (create() writes one; publish did not).
      if (newMode === 'MANAGED_STOCK' && finalType !== 'variable' && initialStock > 0) {
        await this.prisma.managedStockLedger.create({
          data: {
            productId: id,
            quantity: initialStock,
            direction: 'IN',
            type: 'INITIAL',
            stockBefore: 0,
            stockAfter: initialStock,
            note: 'Initial stock on draft publish',
          },
        });
      }

      await this.cache.invalidateByPrefix('product:');
    } catch (e) {
      this.mapProductWriteError(e);
    }
    return product;
  }

  async bulkRemove(ids: string[]) {
    const results = { success: 0, failed: 0, errors: [] as string[] };
    for (const id of ids) {
      try {
        await this.remove(id);
        results.success++;
      } catch (e: any) {
        results.failed++;
        results.errors.push(`${id}: ${e.message}`);
      }
    }
    return results;
  }

  async bulkUpdate(ids: string[], data: UpdateProductDto) {
    const results = { success: 0, failed: 0, errors: [] as string[] };
    for (const id of ids) {
      try {
        await this.update(id, data);
        results.success++;
      } catch (e: any) {
        results.failed++;
        results.errors.push(`${id}: ${e.message}`);
      }
    }
    await this.cache.invalidateByPrefix('product:');
    return results;
  }

  async generateVariants(productId: string, dto: GenerateVariantsDto) {
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });

    const existingOrderItems = await this.prisma.orderItem.findFirst({
      where: { variant: { productId } },
      select: { id: true },
    });
    if (existingOrderItems) {
      throw new BadRequestException(
        'Cannot regenerate variants — product has existing orders linked to current variants.',
      );
    }

    const attributeIds = dto.attributeIds;
    const valueWhere: any = { attributeId: { in: attributeIds } };
    if (dto.attributeValueIds?.length) {
      valueWhere.id = { in: dto.attributeValueIds };
    }
    const attributeValues = await this.prisma.attributeValue.findMany({
      where: valueWhere,
      include: { attribute: true },
    });

    const grouped: Record<string, typeof attributeValues> = {};
    for (const av of attributeValues) {
      if (!grouped[av.attributeId]) grouped[av.attributeId] = [];
      grouped[av.attributeId].push(av);
    }

    const groups = Object.values(grouped);
    const combinations = this.cartesian(groups);
    if (combinations.length > 500) {
      throw new BadRequestException(
        'Too many variant combinations (max 500) — narrow the attribute selection',
      );
    }

    const variants = combinations.map((combo, index) => {
      const values = combo.map((av) => av.value).join(' / ');
      const sku = `${product.sku || 'PRD'}-${values.replace(/\s+/g, '-').replace(/\//g, '_').toUpperCase()}`;
      return {
        productId,
        sku,
        sortOrder: index,
        price: dto.defaultPrice || Number(product.basePrice),
        salePrice: dto.defaultSalePrice ?? undefined,
        standardCost: dto.defaultStandardCost ?? undefined,
        managedStockQuantity: dto.defaultManagedStockQuantity || 0,
        attributeValues: {
          create: combo.map((av) => ({ attributeValueId: av.id })),
        },
      };
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.productVariant.deleteMany({ where: { productId } });
      for (const v of variants) {
        await tx.productVariant.create({ data: v });
      }
      if (variants.length > 0) {
        await tx.product.update({
          where: { id: productId },
          data: {
            type: 'variable',
            managedStockQuantity: 0,
            manageStock: false,
          },
        });
      }
    });

    // PLP scale round: the regenerated set carries fresh prices.
    await this.syncEffectivePrice(productId);

    return this.findOne(productId);
  }

  private cartesian(arrays: any[][]): any[][] {
    return arrays.reduce(
      (acc, curr) => acc.flatMap((a) => curr.map((b) => [...a, b])),
      [[]] as any[][],
    );
  }

  async updateVariant(
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
  ) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
    });
    if (!variant || variant.productId !== productId) {
      throw new NotFoundException('Variant not found');
    }
    if (dto.managedStockQuantity !== undefined) {
      throw new BadRequestException(
        'Variant stock cannot be edited directly. Use Inventory > Adjust Stock to change stock levels.',
      );
    }
    const data: any = {};
    if (dto.sku !== undefined) data.sku = dto.sku;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.salePrice !== undefined) data.salePrice = dto.salePrice;
    if (dto.standardCost !== undefined) data.standardCost = dto.standardCost;
    if (dto.image !== undefined) data.image = dto.image;
    if (dto.images !== undefined) data.images = dto.images as any;
    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data,
    });
    const syncImages = dto.images || (dto.image !== undefined ? (dto.image ? [dto.image] : []) : undefined);
    if (syncImages !== undefined) {
      await this.media.syncEntityImages('variant', variantId, syncImages);
    }
    // PLP scale round: a variant price edit moves the parent's sort
    // price (the helper writes only when the value actually changed,
    // so image-only edits stay read-only).
    await this.syncEffectivePrice(productId);
    return updated;
  }

  async reorderVariants(productId: string, orderedIds: string[]) {
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.productVariant.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    return this.findOne(productId);
  }

  private async enrichProductsWithAvailableStock(products: any[]) {
    if (products.length === 0) return products;

    const productIds = products.map((p) => p.id);
    const physicalSums = await this.prisma.physicalInventory.groupBy({
      by: ['productId', 'variantId'],
      _sum: {
        quantity: true,
        reservedQuantity: true,
      },
      where: {
        productId: { in: productIds },
      },
    });

    // Physical sums split by row kind: variantId-null rows belong to
    // simple products; variant rows belong to that variant only. A variable
    // product's total is the sum over its ACTIVE variants — summing every
    // row of the product (the old productSumMap) credited stock held by
    // inactive variants, and the managed branch subtracted the PARENT's
    // reservedStock from the variant quantity sum even though reservations
    // live on the variants.
    const simpleSumMap = new Map<string, number>();
    const simpleReservedMap = new Map<string, number>();
    const variantSumMap = new Map<string, number>();
    const variantReservedMap = new Map<string, number>();

    for (const s of physicalSums) {
      const pId = s.productId;
      const vId = s.variantId;
      const qty = s._sum.quantity ?? 0;
      const reserved = s._sum.reservedQuantity ?? 0;

      if (vId) {
        variantSumMap.set(vId, qty);
        variantReservedMap.set(vId, reserved);
      } else {
        simpleSumMap.set(pId, (simpleSumMap.get(pId) ?? 0) + qty);
        simpleReservedMap.set(pId, (simpleReservedMap.get(pId) ?? 0) + reserved);
      }
    }

    for (const p of products) {
      const isVariable = p.type === 'variable' && Array.isArray(p.variants);
      const activeVariants = isVariable
        ? p.variants.filter((v: any) => v.isActive !== false)
        : [];
      const managedAvailable = isVariable
        ? activeVariants.reduce(
            (sum: number, v: any) =>
              sum + ((v.managedStockQuantity ?? 0) - (v.reservedStock ?? 0)),
            0,
          )
        : (p.managedStockQuantity ?? 0) - (p.reservedStock ?? 0);
      const physicalAvailable = isVariable
        ? activeVariants.reduce(
            (sum: number, v: any) =>
              sum +
              ((variantSumMap.get(v.id) ?? 0) -
                (variantReservedMap.get(v.id) ?? 0)),
            0,
          )
        : (simpleSumMap.get(p.id) ?? 0) - (simpleReservedMap.get(p.id) ?? 0);

      p.availableStock =
        p.availabilityMode === 'MANAGED_STOCK'
          ? managedAvailable
          : p.availabilityMode === 'INVENTORY_CONTROLLED'
            ? physicalAvailable
            : p.availabilityMode === 'ALWAYS_IN_STOCK'
              ? null
              : 0;

      if (p.variants) {
        for (const v of p.variants) {
          const vPhysicalStock = variantSumMap.get(v.id) ?? 0;
          const vPhysicalReserved = variantReservedMap.get(v.id) ?? 0;
          v.availableStock =
            p.availabilityMode === 'MANAGED_STOCK'
              ? v.managedStockQuantity - (v.reservedStock ?? 0)
              : p.availabilityMode === 'INVENTORY_CONTROLLED'
                ? vPhysicalStock - vPhysicalReserved
                : p.availabilityMode === 'ALWAYS_IN_STOCK'
                  ? null
                  : 0;
        }
      }
    }

    return products;
  }

  private async enrichWithDerivatives(products: any[]) {
    const allUrls = new Set<string>();
    for (const p of products) {
      if (p.image) allUrls.add(p.image);
      if (Array.isArray(p.images)) {
        for (const url of p.images) {
          if (url) allUrls.add(url);
        }
      }
      if (Array.isArray(p.variants)) {
        for (const v of p.variants) {
          if (v.image) allUrls.add(v.image);
          if (Array.isArray(v.images)) {
            for (const url of v.images) {
              if (url) allUrls.add(url);
            }
          }
        }
      }
    }

    if (allUrls.size === 0) return;

    const derived = await this.mediaResolver.resolve([...allUrls]);
    for (const p of products) {
      const urls = new Set<string>();
      if (p.image) urls.add(p.image);
      if (Array.isArray(p.images)) p.images.forEach(u => u && urls.add(u));
      if (Array.isArray(p.variants)) {
        for (const v of p.variants) {
          if (v.image) urls.add(v.image);
          if (Array.isArray(v.images)) v.images.forEach(u => u && urls.add(u));
        }
      }
      const meta: Record<string, any> = {};
      for (const url of urls) {
        if (derived[url]) meta[url] = derived[url];
      }
      p._mediaMeta = meta;
    }
  }

  /**
   * Stored-HTML guardrail (scale program, 2026-11-04): <img> tags embedded
   * in the rich-text description / specifications that point at ORIGINAL
   * uploads are rewritten to derivatives on the public PDP read path (see
   * media/html-image-rewrite). Response-only — the stored HTML is never
   * modified, so the admin editor (findOne) round-trips it verbatim.
   */
  private async rewriteDescriptionImages(p: any) {
    try {
      const sections =
        p?.descriptionSections && typeof p.descriptionSections === 'object'
          ? (p.descriptionSections as Record<string, unknown>)
          : null;
      const specs = sections?.specifications;
      const paths = new Set<string>();
      if (typeof p?.description === 'string') {
        for (const u of extractUploadImagePaths(p.description)) paths.add(u);
      }
      if (typeof specs === 'string') {
        for (const u of extractUploadImagePaths(specs)) paths.add(u);
      }
      if (paths.size === 0) return;
      const map = await this.mediaResolver.resolve([...paths]);
      if (typeof p.description === 'string') {
        p.description = rewriteUploadImages(p.description, map);
      }
      if (sections && typeof specs === 'string') {
        sections.specifications = rewriteUploadImages(specs, map);
      }
    } catch {
      // Never break the PDP over a content rewrite — originals fall back.
    }
  }

  async checkSlugAvailability(slug: string) {
    const existing = await this.prisma.product.findUnique({ where: { slug }, select: { id: true } });
    return { available: !existing };
  }

  async checkSkuAvailability(sku: string, excludeId?: string) {
    const productWithSku = await this.prisma.product.findFirst({
      where: {
        sku,
        status: { not: 'draft' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (productWithSku) return { available: false };
    // Variant SKUs are globally unique INCLUDING drafts — excluding drafts
    // here used to report "available" and then 500 the save.
    const variantWithSku = await this.prisma.productVariant.findFirst({
      where: {
        sku,
        ...(excludeId ? { productId: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    return { available: !variantWithSku };
  }

  async removeAllVariants(productId: string) {
    const existingOrderItems = await this.prisma.orderItem.findFirst({
      where: { variant: { productId } },
      select: { id: true },
    });
    if (existingOrderItems) {
      throw new BadRequestException(
        'Cannot remove variants — product has existing orders linked to current variants.',
      );
    }
    await this.prisma.productVariant.deleteMany({ where: { productId } });
    await this.prisma.product.update({
      where: { id: productId },
      data: { type: 'simple', managedStockQuantity: 0, manageStock: true },
    });
    // PLP scale round: back to a simple product — the sort price is the
    // product rule again, not the deleted variants' minimum.
    await this.syncEffectivePrice(productId);
    await this.cache.invalidateByPrefix('product:');
    return { message: 'All variants removed. Product reset to simple type.' };
  }

  async removeVariant(productId: string, variantId: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
    });
    if (!variant || variant.productId !== productId) {
      throw new NotFoundException('Variant not found');
    }
    const existingOrderItem = await this.prisma.orderItem.findFirst({
      where: { variantId },
      select: { id: true },
    });
    if (existingOrderItem) {
      throw new BadRequestException(
        'Cannot delete variant — it has existing orders.',
      );
    }
    await this.media.detachAll('variant', variantId);
    await this.prisma.productVariant.delete({ where: { id: variantId } });
    // PLP scale round: removing the cheapest variant raises the
    // parent's sort price.
    await this.syncEffectivePrice(productId);
    await this.cache.invalidateByPrefix('product:');
    return { message: 'Variant deleted' };
  }
}
