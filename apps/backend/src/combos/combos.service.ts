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

  async findAll(query: {
    page?: number;
    perPage?: number;
    search?: string;
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
      ];
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const [data, total] = await Promise.all([
      this.prisma.combo.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { [query.sort || 'createdAt']: query.order || 'desc' },
        include: {
          category: { select: { id: true, name: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, slug: true, images: true, basePrice: true } },
              variant: { select: { id: true, sku: true, price: true } },
            },
          },
        },
      }),
      this.prisma.combo.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
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
              select: { id: true, name: true, slug: true, sku: true, basePrice: true, salePrice: true, stock: true, images: true },
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
    const existing = await this.prisma.combo.findUnique({ where: { slug: dto.slug } });
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
        manageStock: dto.manageStock || false,
        stock: dto.stock || 0,
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
            product: { select: { id: true, name: true, slug: true, images: true, basePrice: true } },
            variant: { select: { id: true, sku: true, price: true } },
          },
        },
      },
    });

    const allUrls = [
      ...(dto.image ? [dto.image] : []),
      ...((dto.images || []) as string[]),
    ];
    if (allUrls.length) {
      const synced = await this.media.syncEntityImages('combo', combo.id, allUrls);
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
        combo.images = rest as any;
      }
    }

    return combo;
  }

  async update(id: string, dto: UpdateComboDto) {
    const combo = await this.prisma.combo.findUnique({ where: { id } });
    if (!combo) throw new NotFoundException('Combo not found');

    if (dto.slug && dto.slug !== combo.slug) {
      const exist = await this.prisma.combo.findUnique({ where: { slug: dto.slug } });
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
          ? (dto.images as string[])
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
