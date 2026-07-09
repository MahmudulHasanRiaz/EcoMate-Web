import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProductDto,
  UpdateProductDto,
  GenerateVariantsDto,
  UpdateVariantDto,
} from './dto/product.dto';
import { MediaService } from '../media/media.service';
import { CacheService } from '../cache/cache.service';

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
  ) {}

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

  private buildWhere(query: {
    search?: string;
    type?: string;
    categoryIds?: string[];
    isActive?: boolean;
    isFeatured?: boolean;
    ids?: string[];
  }) {
    const where: any = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
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
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 24;

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
            { type: { not: 'variable' }, stock: { gt: 0 } },
            { type: 'variable', variants: { some: { stock: { gt: 0 } } } },
          ],
        },
      ];
    }
    let orderBy: any = { [query.sort || 'createdAt']: query.order || 'desc' };
    if (query.sort === 'basePrice' || query.sort === 'price') {
      const dir = query.order === 'asc' ? 'asc' : 'desc';
      orderBy = [
        { salePrice: { sort: dir, nulls: 'last' } },
        { basePrice: dir },
      ];
    } else if (query.sort === 'popularity') {
      orderBy = {
        orderItems: {
          _count: query.order || 'desc',
        },
      };
    }

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
  }) {
    const perPage = query.perPage || 24;
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
            { type: { not: 'variable' }, stock: { gt: 0 } },
            { type: 'variable', variants: { some: { stock: { gt: 0 } } } },
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
    await this.cache.set(cacheKey, product);
    return product;
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
        },
      },
    });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  async create(dto: CreateProductDto) {
    const existing = await this.prisma.product.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) throw new ConflictException('Slug already exists');

    const categoryIds =
      dto.categoryIds || (dto.categoryId ? [dto.categoryId] : []);
    const categoryId = dto.categoryId || categoryIds[0] || null;

    const avMode: string =
      dto.type === 'variable'
        ? 'MANAGED_STOCK'
        : dto.availabilityMode ||
          (dto.manageStock ? 'MANAGED_STOCK' : 'INVENTORY_CONTROLLED');

    const product = await this.prisma.product.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        type: dto.type || 'simple',
        description: dto.description,
        shortDesc: dto.shortDesc,
        brandId: dto.brandId,
        basePrice: dto.basePrice,
        salePrice: dto.salePrice,
        sku: dto.sku,
        managedStockQuantity:
          dto.type === 'variable' ? 0 : dto.managedStockQuantity || 0,
        lowStockQty: dto.lowStockQty,
        categoryId: categoryId || undefined,
        productCategories:
          categoryIds.length > 0
            ? { create: categoryIds.map((cid) => ({ categoryId: cid })) }
            : undefined,
        sizeChartId: dto.sizeChartId,
        tags: dto.tags as any,
        images: (dto.images || []) as any,
        seoMeta: dto.seoMeta,
        isFeatured: dto.isFeatured || false,
        isActive: dto.isActive ?? true,
        availabilityMode: avMode as any,
        manageStock: avMode === 'MANAGED_STOCK',
        variants: dto.variants
          ? {
              create: dto.variants.map((v) => ({
                sku: v.sku,
                price: v.price,
                salePrice: v.salePrice,
                managedStockQuantity: v.managedStockQuantity || 0,
                image: v.image,
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
        },
      },
    });

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
        if (variant.image) {
          await this.media.syncEntityImages('variant', variant.id, [
            variant.image,
          ]);
        }
      }
    }

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
    if (dto.tags) data.tags = dto.tags as any;
    if (dto.images !== undefined) data.images = dto.images as any;
    if (dto.seoMeta) data.seoMeta = dto.seoMeta;
    delete data.variants;
    delete data.attributes;
    delete data.categoryIds;

    if (p.type === 'variable' || p.type === 'combo') {
      delete data.managedStockQuantity;
      delete data.manageStock;
    } else if (dto.availabilityMode) {
      data.manageStock = dto.availabilityMode === 'MANAGED_STOCK';
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
        },
      },
    });

    await this.syncTags(dto.tags || [], id);

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

    if (p.type !== 'variable' && p.type !== 'combo') {
      const newMode: string | undefined =
        dto.availabilityMode ??
        (dto.manageStock !== undefined
          ? dto.manageStock
            ? 'MANAGED_STOCK'
            : 'INVENTORY_CONTROLLED'
          : undefined);

      if (newMode && newMode !== p.availabilityMode) {
        if (newMode === 'MANAGED_STOCK') {
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
        } else if (p.availabilityMode === 'MANAGED_STOCK') {
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

    const variants = combinations.map((combo) => {
      const values = combo.map((av) => av.value).join(' / ');
      const sku = `${product.sku || 'PRD'}-${values.replace(/\s+/g, '-').replace(/\//g, '_').toUpperCase()}`;
      return {
        productId,
        sku,
        price: dto.defaultPrice || Number(product.basePrice),
        salePrice: dto.defaultSalePrice ?? undefined,
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
    if (dto.image !== undefined) data.image = dto.image;
    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data,
    });
    if (dto.image !== undefined) {
      await this.media.syncEntityImages(
        'variant',
        variantId,
        dto.image ? [dto.image] : [],
      );
    }
    return updated;
  }
}
