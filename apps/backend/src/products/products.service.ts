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
} from './dto/product.dto';
import { MediaService } from '../media/media.service';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async findAll(query: {
    page?: number;
    perPage?: number;
    search?: string;
    type?: string;
    categoryId?: string;
    isActive?: boolean;
    sort?: string;
    order?: string;
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 10;
    const where: any = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.type) where.type = query.type;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { [query.sort || 'createdAt']: query.order || 'desc' },
        include: {
          category: { select: { id: true, name: true } },
          variants: {
            include: {
              attributeValues: {
                include: { attributeValue: { include: { attribute: true } } },
              },
            },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
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

    const product = await this.prisma.product.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        type: dto.type || 'simple',
        description: dto.description,
        shortDesc: dto.shortDesc,
        basePrice: dto.basePrice,
        salePrice: dto.salePrice,
        sku: dto.sku,
        stock: dto.stock || 0,
        lowStockQty: dto.lowStockQty,
        categoryId: dto.categoryId,
        tags: dto.tags as any,
        images: dto.images as any,
        seoMeta: dto.seoMeta,
        isFeatured: dto.isFeatured || false,
        isActive: dto.isActive ?? true,
        manageStock: dto.manageStock || false,
        variants: dto.variants
          ? {
              create: dto.variants.map((v) => ({
                sku: v.sku,
                price: v.price,
                stock: v.stock || 0,
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
        variants: {
          include: {
            attributeValues: {
              include: { attributeValue: { include: { attribute: true } } },
            },
          },
        },
      },
    });

    if (dto.images) {
      const ids = dto.images.map((url) => url.split('/').pop()).filter(Boolean);
      for (const fname of ids) {
        const media = await this.prisma.media.findFirst({
          where: { filename: fname },
        });
        if (media) {
          await this.media.attach(media.id, 'product', product.id);
        }
      }
    }

    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
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
    if (dto.images) data.images = dto.images as any;
    if (dto.seoMeta) data.seoMeta = dto.seoMeta;
    delete data.variants;
    delete data.attributes;

    const product = await this.prisma.product.update({
      where: { id },
      data,
      include: { category: true, variants: true },
    });

    if (dto.images !== undefined) {
      const ids = (dto.images || [])
        .map((url: string) => url.split('/').pop())
        .filter(Boolean);
      for (const fname of ids) {
        const media = await this.prisma.media.findFirst({
          where: { filename: fname },
        });
        if (media) {
          await this.media.attach(media.id, 'product', id);
        }
      }
    }

    return product;
  }

  async remove(id: string) {
    await this.prisma.product.findUniqueOrThrow({ where: { id } });
    await this.prisma.product.delete({ where: { id } });
    return { message: 'Product deleted' };
  }

  async generateVariants(productId: string, dto: GenerateVariantsDto) {
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });
    await this.prisma.productVariant.deleteMany({ where: { productId } });

    const attributeIds = dto.attributeIds;
    const attributeValues = await this.prisma.attributeValue.findMany({
      where: { attributeId: { in: attributeIds } },
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
        stock: dto.defaultStock || 0,
        attributeValues: {
          create: combo.map((av) => ({ attributeValueId: av.id })),
        },
      };
    });

    for (const v of variants) {
      await this.prisma.productVariant.create({ data: v });
    }

    if (variants.length > 0) {
      await this.prisma.product.update({
        where: { id: productId },
        data: { type: 'variable' },
      });
    }

    return this.findOne(productId);
  }

  private cartesian(arrays: any[][]): any[][] {
    return arrays.reduce(
      (acc, curr) => acc.flatMap((a) => curr.map((b) => [...a, b])),
      [[]] as any[][],
    );
  }
}
