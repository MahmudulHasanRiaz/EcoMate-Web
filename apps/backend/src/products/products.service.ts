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
import { CacheService } from '../cache/cache.service';
import { StockRouterService } from '../stock/stock-router.service';
import { StockService } from '../stock/stock.service';
import {
  InitialPhysicalStockService,
  InitialPhysicalUnit,
} from '../stock/initial-physical-stock.service';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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
    private readonly initialPhysicalStock: InitialPhysicalStockService,
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
   * B4: with Inventory Management ON, confirming a MANAGED_STOCK order
   * allocates PHYSICAL stock, so units that exist only in the managed counter
   * can never be confirmed. New products (and published drafts) therefore
   * mirror their initial units into the physical layer at creation.
   *
   * The warehouse is resolved BEFORE the product row is written so a missing
   * warehouse fails the request loudly instead of leaving behind a product
   * that can be ordered but never fulfilled. The same seeding runs on the CSV
   * import path through InitialPhysicalStockService.
   */
  private initialStockOf(dto: {
    type?: string;
    managedStockQuantity?: number;
    variants?: Array<{ managedStockQuantity?: number }>;
  }): number {
    if (dto.type === 'variable') {
      return (dto.variants ?? []).reduce(
        (sum, v) => sum + (v.managedStockQuantity ?? 0),
        0,
      );
    }
    return dto.managedStockQuantity ?? 0;
  }

  private async mirrorInitialStockToPhysical(params: {
    product: any;
    avMode: string;
    warehouseId: string | null;
    performedBy?: string;
  }): Promise<void> {
    const { product, avMode, warehouseId, performedBy } = params;
    if (!warehouseId || avMode !== 'MANAGED_STOCK') return;

    const units: InitialPhysicalUnit[] = [];
    if (product.type === 'variable') {
      for (const variant of product.variants ?? []) {
        const quantity = Number(variant.managedStockQuantity) || 0;
        if (quantity > 0) units.push({ variantId: variant.id, quantity });
      }
    } else {
      const quantity = Number(product.managedStockQuantity) || 0;
      if (quantity > 0) units.push({ quantity });
    }
    if (units.length === 0) return;

    await this.initialPhysicalStock.mirrorUnits({
      productId: product.id,
      productWarehouseId: product.warehouseId ?? null,
      warehouseId,
      units,
      reference: 'Initial stock on product creation',
      performedBy,
    });
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
  }) {
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
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            // MANAGED_STOCK non-variable: check stock quantity
            { availabilityMode: 'MANAGED_STOCK', type: { not: 'variable' }, managedStockQuantity: { gt: 0 } },
            // MANAGED_STOCK variable: any active variant with stock
            { availabilityMode: 'MANAGED_STOCK', type: 'variable', variants: { some: { isActive: true, managedStockQuantity: { gt: 0 } } } },
            // ALWAYS_IN_STOCK: always available
            { availabilityMode: 'ALWAYS_IN_STOCK' },
            // INVENTORY_CONTROLLED: check physical inventory records of active variants
            {
              availabilityMode: 'INVENTORY_CONTROLLED',
              OR: [
                {
                  type: { not: 'variable' },
                  physicalInventories: { some: { quantity: { gt: 0 } } },
                },
                {
                  type: 'variable',
                  physicalInventories: {
                    some: {
                      quantity: { gt: 0 },
                      variant: { isActive: true },
                    },
                  },
                },
              ],
            },
          ],
        },
      ];
    }
    let orderBy: any;
    if (query.sort === 'basePrice' || query.sort === 'price') {
      const dir = query.order === 'asc' ? 'asc' : 'desc';
      orderBy = [
        { salePrice: { sort: dir, nulls: 'last' } },
        { basePrice: dir },
        { id: dir },
      ];
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

    let data: any[];
    let total: number;

    if (query.sort === 'basePrice' || query.sort === 'price') {
      const allMatching = await this.prisma.product.findMany({
        where,
        select: {
          id: true,
          basePrice: true,
          salePrice: true,
          type: true,
          variants: {
            select: {
              price: true,
              salePrice: true,
            },
          },
        },
      });

      total = allMatching.length;
      const dir = query.order === 'asc' ? 'asc' : 'desc';

      const getEffectivePrice = (p: any): number => {
        if (p.type === 'variable' && p.variants?.length > 0) {
          const prices = p.variants
            .map((v: any) => Number(v.salePrice ?? v.price))
            .filter((price: number) => !isNaN(price) && price > 0);
          if (prices.length > 0) {
            return Math.min(...prices);
          }
        }
        return Number(p.salePrice ?? p.basePrice) || 0;
      };

      const sorted = allMatching.sort((a, b) => {
        const priceA = getEffectivePrice(a);
        const priceB = getEffectivePrice(b);
        if (priceA !== priceB) {
          return dir === 'asc' ? priceA - priceB : priceB - priceA;
        }
        return a.id.localeCompare(b.id);
      });

      const paginatedIds = sorted
        .slice((page - 1) * perPage, page * perPage)
        .map((p) => p.id);

      const rawData = await this.prisma.product.findMany({
        where: { id: { in: paginatedIds } },
        include: this.listInclude,
      });

      // Maintain exact sorted order of IDs
      data = paginatedIds
        .map((id) => rawData.find((item) => item.id === id)!)
        .filter(Boolean);
    } else {
      [data, total] = await Promise.all([
        this.prisma.product.findMany({
          where,
          skip: (page - 1) * perPage,
          take: perPage,
          orderBy,
          include: this.listInclude,
        }),
        this.prisma.product.count({ where }),
      ]);
    }

    await this.enrichProductsWithAvailableStock(data);
    await this.enrichWithDerivatives(data);
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
      data,
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
  }) {
    const perPage = this.clampListPerPage(query.perPage);
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
      filters.AND = [
        ...(filters.AND || []),
        {
          OR: [
            { availabilityMode: 'MANAGED_STOCK', type: { not: 'variable' }, managedStockQuantity: { gt: 0 } },
            { availabilityMode: 'MANAGED_STOCK', type: 'variable', variants: { some: { isActive: true, managedStockQuantity: { gt: 0 } } } },
            { availabilityMode: 'ALWAYS_IN_STOCK' },
            {
              availabilityMode: 'INVENTORY_CONTROLLED',
              OR: [
                {
                  type: { not: 'variable' },
                  physicalInventories: { some: { quantity: { gt: 0 } } },
                },
                {
                  type: 'variable',
                  physicalInventories: {
                    some: {
                      quantity: { gt: 0 },
                      variant: { isActive: true },
                    },
                  },
                },
              ],
            },
          ],
        },
      ];
    }
    const cursorWhere: any = { ...filters };
    const existingAnd = cursorWhere.AND?.length
      ? [...cursorWhere.AND]
      : undefined;
    if (query.cursor) {
      const decoded = this.decodeCursor(query.cursor);
      if (decoded) {
        const cursorFilter = {
          OR: [
            { createdAt: { lt: decoded.createdAt } },
            { createdAt: decoded.createdAt, id: { lt: decoded.id } },
          ],
        };
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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: this.listInclude,
      }),
      this.prisma.product.count({ where: filters }),
    ]);
    await this.enrichProductsWithAvailableStock(data);
    await this.enrichWithDerivatives(data);
    const hasMore = data.length === perPage;
    const last = data[data.length - 1];
    const nextCursor =
      hasMore && last ? this.encodeCursor(last.createdAt, last.id) : null;
    return {
      data,
      meta: {
        total,
        perPage,
        nextCursor,
        hasMore,
      },
    };
  }

  async findBySlug(slug: string) {
    const cacheKey = `product:slug:${slug}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;
    const product = await this.prisma.product.findUnique({
      where: { slug },
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

    const initialWarehouseId = await this.initialPhysicalStock.resolveWarehouse(
      avMode,
      this.initialStockOf(dto as any),
      dto.warehouseId,
    );

    const scalars = {
      name: dto.name,
      slug: dto.slug,
      type: dto.type || 'simple',
      description: dto.description,
      shortDesc: dto.shortDesc,
      brandId: dto.brandId,
      basePrice: dto.basePrice,
      salePrice: dto.salePrice,
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
      attributeValues: v.attributeValues
        ? {
            create: v.attributeValues.map((av) => ({
              attributeValueId: av.attributeValueId,
            })),
          }
        : undefined,
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

    await this.mirrorInitialStockToPhysical({
      product,
      avMode,
      warehouseId: initialWarehouseId,
    });

    return product;
  }

  async update(id: string, dto: UpdateProductDto, performedBy?: string) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    if (dto.slug && dto.slug !== p.slug) {
      const exist = await this.prisma.product.findUnique({
        where: { slug: dto.slug },
      });
      if (exist) throw new ConflictException('Slug already exists');
    }
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
        if (p.type !== 'variable' && p.type !== 'combo') {
          if (p.managedStockQuantity > 0) {
            await this.prisma.managedStockLedger.create({
              data: {
                productId: id,
                quantity: p.managedStockQuantity,
                direction: 'OUT',
                type: 'ADJUSTMENT',
                stockBefore: p.managedStockQuantity,
                stockAfter: 0,
                note: `Mode changed from MANAGED_STOCK to ${newMode} — snapshot: ${p.managedStockQuantity} units`,
                performedById: performedBy,
              },
            });
            await this.prisma.product.update({
              where: { id },
              data: { managedStockQuantity: 0 },
            });
          }
        } else if (p.type === 'variable') {
          const variants = await this.prisma.productVariant.findMany({
            where: { productId: id },
          });
          for (const v of variants) {
            if (v.managedStockQuantity > 0) {
              await this.prisma.managedStockLedger.create({
                data: {
                  productId: id,
                  variantId: v.id,
                  quantity: v.managedStockQuantity,
                  direction: 'OUT',
                  type: 'ADJUSTMENT',
                  stockBefore: v.managedStockQuantity,
                  stockAfter: 0,
                  note: `Mode changed from MANAGED_STOCK to ${newMode} — variant snapshot: ${v.managedStockQuantity} units`,
                  performedById: performedBy,
                },
              });
              await this.prisma.productVariant.update({
                where: { id: v.id },
                data: { managedStockQuantity: 0 },
              });
            }
          }
          await this.prisma.product.update({
            where: { id },
            data: { managedStockQuantity: 0 },
          });
        }
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
      dto.slug?.trim()
        ? dto.slug.trim()
        : `draft-${randomUUID().slice(0, 8)}`,
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
                attributeValues: v.attributeValues
                  ? {
                      create: v.attributeValues.map((av) => ({
                        attributeValueId: av.attributeValueId,
                      })),
                    }
                  : undefined,
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
    if (dto.slug && dto.slug !== p.slug) {
      const exists = await this.prisma.product.findUnique({
        where: { slug: dto.slug },
      });
      if (exists) throw new ConflictException('Slug already exists');
    }

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
          attributeValues: v.attributeValues
            ? {
                create: v.attributeValues.map((av) => ({
                  attributeValueId: av.attributeValueId,
                })),
              }
            : undefined,
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
    await this.cache.invalidateByPrefix('product:');
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

    const slug =
      dto.slug?.trim() && dto.slug.trim() !== p.slug
        ? await this.ensureUniqueSlug(dto.slug.trim())
        : p.slug;

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

    // Publishing is creation-equivalent: the same initial-stock mirror runs
    // for a draft that goes live with MANAGED_STOCK units.
    const finalType = dto.type || p.type;
    let initialStock: number;
    if (finalType === 'variable') {
      initialStock = dto.variants
        ? dto.variants.reduce(
            (sum, v) => sum + (v.managedStockQuantity ?? 0),
            0,
          )
        : (
            await this.prisma.productVariant.findMany({
              where: { productId: id },
              select: { managedStockQuantity: true },
            })
          ).reduce((sum, v) => sum + (v.managedStockQuantity ?? 0), 0);
    } else {
      initialStock = dto.managedStockQuantity ?? p.managedStockQuantity ?? 0;
    }
    const initialWarehouseId = await this.initialPhysicalStock.resolveWarehouse(
      newMode,
      initialStock,
      dto.warehouseId ?? p.warehouseId,
    );

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
          attributeValues: v.attributeValues
            ? {
                create: v.attributeValues.map((av) => ({
                  attributeValueId: av.attributeValueId,
                })),
              }
            : undefined,
        })),
      };
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

    await this.mirrorInitialStockToPhysical({
      product,
      avMode: newMode,
      warehouseId: initialWarehouseId,
    });

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

    const productSumMap = new Map<string, number>();
    const productReservedMap = new Map<string, number>();
    const variantSumMap = new Map<string, number>();
    const variantReservedMap = new Map<string, number>();

    for (const s of physicalSums) {
      const pId = s.productId;
      const vId = s.variantId;
      const qty = s._sum.quantity ?? 0;
      const reserved = s._sum.reservedQuantity ?? 0;

      productSumMap.set(pId, (productSumMap.get(pId) ?? 0) + qty);
      productReservedMap.set(pId, (productReservedMap.get(pId) ?? 0) + reserved);

      if (vId) {
        variantSumMap.set(vId, qty);
        variantReservedMap.set(vId, reserved);
      }
    }

    for (const p of products) {
      const physicalStockSum = productSumMap.get(p.id) ?? 0;
      const physicalReservedSum = productReservedMap.get(p.id) ?? 0;
      const managedStockSum = p.type === 'variable' && p.variants
        ? p.variants.reduce((sum, v) => sum + (v.managedStockQuantity ?? 0), 0)
        : p.managedStockQuantity;

      p.availableStock =
        p.availabilityMode === 'MANAGED_STOCK'
          ? managedStockSum - (p.reservedStock ?? 0)
          : p.availabilityMode === 'INVENTORY_CONTROLLED'
            ? physicalStockSum - physicalReservedSum
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
    await this.cache.invalidateByPrefix('product:');
    return { message: 'Variant deleted' };
  }
}
