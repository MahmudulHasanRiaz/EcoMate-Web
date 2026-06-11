import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateComboDto, UpdateComboDto } from './dto/combos.dto';
import { MediaService } from '../media/media.service';

@Injectable()
export class CombosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  private buildWhere(query: {
    search?: string;
    categoryId?: string;
    isActive?: boolean;
  }) {
    const where: any = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        {
          items: {
            some: {
              product: {
                name: { contains: query.search, mode: 'insensitive' },
              },
            },
          },
        },
      ];
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    return where;
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

  private readonly comboInclude = {
    category: { select: { id: true, name: true } },
    items: {
      include: {
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            images: true,
            basePrice: true,
            type: true,
          },
        },
        variant: { select: { id: true, sku: true, price: true } },
      },
    },
  };

  async findAll(query: {
    page?: number;
    perPage?: number;
    search?: string;
    categoryId?: string;
    isActive?: boolean;
    sort?: string;
    order?: string;
    cursor?: string;
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 12;
    const where = this.buildWhere(query);
    const [data, total] = await Promise.all([
      this.prisma.combo.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { [query.sort || 'createdAt']: query.order || 'desc' },
        include: this.comboInclude,
      }),
      this.prisma.combo.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
        nextCursor: null,
        hasMore: false,
      },
    };
  }

  async findAllCursor(query: {
    cursor?: string;
    perPage?: number;
    search?: string;
    categoryId?: string;
    isActive?: boolean;
  }) {
    const perPage = query.perPage || 12;
    const where: any = { ...this.buildWhere(query) };
    if (query.cursor) {
      const decoded = this.decodeCursor(query.cursor);
      if (decoded) {
        where.OR = [
          { createdAt: { lt: decoded.createdAt } },
          {
            createdAt: decoded.createdAt,
            id: { lt: decoded.id },
          },
        ];
      }
    }
    const [data, total] = await Promise.all([
      this.prisma.combo.findMany({
        where,
        take: perPage,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: this.comboInclude,
      }),
      this.prisma.combo.count({
        where: this.buildWhere(query),
      }),
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

  async findOne(id: string) {
    const combo = await this.prisma.combo.findUnique({
      where: { id },
      include: {
        category: true,
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                sku: true,
                basePrice: true,
                salePrice: true,
                stock: true,
                images: true,
                type: true,
                variants: {
                  select: {
                    id: true,
                    sku: true,
                    price: true,
                    stock: true,
                    image: true,
                    isActive: true,
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
              },
            },
            variant: {
              select: { id: true, sku: true, price: true, stock: true },
            },
          },
        },
      },
    });
    if (!combo) throw new NotFoundException('Combo not found');
    return combo;
  }

  async create(dto: CreateComboDto) {
    const existing = await this.prisma.combo.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) throw new ConflictException('Slug already exists');

    const combo = await this.prisma.combo.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        shortDesc: dto.shortDesc,
        basePrice: dto.basePrice,
        salePrice: dto.salePrice,
        image: dto.image,
        images: (dto.images || []) as any,
        categoryId: dto.categoryId,
        tags: dto.tags as any,
        seoMeta: dto.seoMeta,
        isFeatured: dto.isFeatured || false,
        isActive: dto.isActive ?? true,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            price: item.price,
          })),
        },
      },
      include: {
        category: true,
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                images: true,
                basePrice: true,
              },
            },
            variant: { select: { id: true, sku: true, price: true } },
          },
        },
      },
    });

    const allUrls = [...(dto.image ? [dto.image] : []), ...(dto.images || [])];
    if (allUrls.length) {
      const synced = await this.media.syncEntityImages(
        'combo',
        combo.id,
        allUrls,
      );
      const [featured, ...rest] = synced;
      if (
        featured !== dto.image ||
        JSON.stringify(rest) !== JSON.stringify(dto.images || [])
      ) {
        await this.prisma.combo.update({
          where: { id: combo.id },
          data: { image: featured || null, images: rest as any },
        });
        combo.image = featured || null;
        combo.images = rest;
      }
    }

    return combo;
  }

  async update(id: string, dto: UpdateComboDto) {
    const combo = await this.prisma.combo.findUnique({ where: { id } });
    if (!combo) throw new NotFoundException('Combo not found');

    if (dto.slug && dto.slug !== combo.slug) {
      const exist = await this.prisma.combo.findUnique({
        where: { slug: dto.slug },
      });
      if (exist) throw new ConflictException('Slug already exists');
    }

    const data: any = { ...dto };
    delete data.items;

    if (dto.tags) data.tags = dto.tags as any;
    if (dto.images !== undefined) data.images = dto.images as any;
    if (dto.seoMeta) data.seoMeta = dto.seoMeta;
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.endDate) data.endDate = new Date(dto.endDate);

    await this.prisma.combo.update({
      where: { id },
      data,
      include: { category: true },
    });

    if (dto.items) {
      await this.prisma.comboItem.deleteMany({ where: { comboId: id } });
      await this.prisma.comboItem.createMany({
        data: dto.items.map((item) => ({
          comboId: id,
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          price: item.price,
        })),
      });
    }

    if (dto.image !== undefined || dto.images !== undefined) {
      const featured = dto.image !== undefined ? dto.image : combo.image;
      const gallery =
        dto.images !== undefined
          ? dto.images
          : (combo.images as string[] | null) || [];
      const allUrls = [...(featured ? [featured] : []), ...gallery];
      const synced = await this.media.syncEntityImages('combo', id, allUrls);
      const [newFeatured, ...rest] = synced;
      await this.prisma.combo.update({
        where: { id },
        data: { image: newFeatured || null, images: rest as any },
      });
    }

    return this.findOne(id);
  }

  async remove(id: string) {
    await this.prisma.combo.findUniqueOrThrow({ where: { id } });
    await this.media.detachAll('combo', id);
    await this.prisma.combo.delete({ where: { id } });
    return { message: 'Combo deleted' };
  }
}
