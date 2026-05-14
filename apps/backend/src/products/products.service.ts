import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: {
    page?: number; perPage?: number; search?: string;
    categoryId?: string; isActive?: boolean; sort?: string; order?: string;
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 10;
    const where: any = {};
    if (query.search) {
      where.OR = [{ name: { contains: query.search, mode: 'insensitive' } }, { slug: { contains: query.search, mode: 'insensitive' } }];
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { [query.sort || 'createdAt']: query.order || 'desc' },
        include: {
          category: { select: { id: true, name: true } },
          variants: { include: { attributeValues: { include: { attributeValue: { include: { attribute: true } } } } } },
          _count: { select: { orderItems: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    return { data, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } };
  }

  async findOne(id: string) {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        variants: { include: { attributeValues: { include: { attributeValue: { include: { attribute: true } } } } } },
      },
    });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  async create(dto: CreateProductDto) {
    const existing = await this.prisma.product.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException('Slug already exists');

    return this.prisma.product.create({
      data: {
        name: dto.name, slug: dto.slug, description: dto.description,
        basePrice: dto.basePrice, salePrice: dto.salePrice,
        categoryId: dto.categoryId, tags: dto.tags as any,
        images: dto.images as any, seoMeta: dto.seoMeta as any, isActive: dto.isActive,
        variants: dto.variants ? {
          create: dto.variants.map(v => ({
            sku: v.sku, price: v.price, stock: v.stock || 0, image: v.image,
            attributeValues: v.attributeValues ? {
              create: v.attributeValues.map(av => ({ attributeValueId: av.attributeValueId })),
            } : undefined,
          })),
        } : undefined,
      },
      include: {
        category: true,
        variants: { include: { attributeValues: { include: { attributeValue: { include: { attribute: true } } } } } },
      },
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    if (dto.slug && dto.slug !== p.slug) {
      const exist = await this.prisma.product.findUnique({ where: { slug: dto.slug } });
      if (exist) throw new ConflictException('Slug already exists');
    }
    const data: any = { ...dto };
    if (dto.tags) data.tags = dto.tags as any;
    if (dto.images) data.images = dto.images as any;
    if (dto.seoMeta) data.seoMeta = dto.seoMeta as any;
    return this.prisma.product.update({ where: { id }, data, include: { category: true, variants: true } });
  }

  async remove(id: string) {
    await this.prisma.product.findUniqueOrThrow({ where: { id } });
    await this.prisma.product.delete({ where: { id } });
    return { message: 'Product deleted' };
  }
}
