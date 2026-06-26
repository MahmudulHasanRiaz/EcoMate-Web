import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { MediaService } from '../media/media.service';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly cache: CacheService,
  ) {}

  async findMenuCategories() {
    const cached = await this.cache.get<any[]>('categories:menu');
    if (cached) return cached;
    const data = await this.prisma.category.findMany({
      where: { showInMenu: true, isActive: true },
      include: {
        children: {
          where: { showInMenu: true, isActive: true },
          orderBy: { menuSortOrder: 'asc' },
        },
      },
      orderBy: { menuSortOrder: 'asc' },
    });
    this.cache.set('categories:menu', data);
    return data;
  }

  async findAll() {
    const cached = await this.cache.get<any[]>('categories:all');
    if (cached) return cached;
    const data = await this.prisma.category.findMany({
      include: { children: true, _count: { select: { products: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    this.cache.set('categories:all', data);
    return data;
  }

  async findOne(id: string) {
    const cat = await this.prisma.category.findUnique({
      where: { id },
      include: {
        children: true,
        parent: true,
        _count: { select: { products: true } },
      },
    });
    if (!cat) throw new NotFoundException('Category not found');
    return cat;
  }

  async create(dto: CreateCategoryDto) {
    const existing = await this.prisma.category.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) throw new ConflictException('Slug already exists');

    const created = await this.prisma.category.create({ data: dto as any });
    this.cache.invalidateByPrefix('categories:');

    if (dto.image) {
      const [resolved] = await this.media.syncEntityImages(
        'category',
        created.id,
        [dto.image],
      );
      if (resolved && resolved !== dto.image) {
        return this.prisma.category.update({
          where: { id: created.id },
          data: { image: resolved },
        });
      }
    }
    return created;
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const cat = await this.prisma.category.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Category not found');

    if (dto.slug && dto.slug !== cat.slug) {
      const exist = await this.prisma.category.findUnique({
        where: { slug: dto.slug },
      });
      if (exist) throw new ConflictException('Slug already exists');
    }

    const updated = await this.prisma.category.update({
      where: { id },
      data: dto as any,
    });
    this.cache.invalidateByPrefix('categories:');

    if (dto.image !== undefined) {
      const urls = dto.image ? [dto.image] : [];
      const synced = await this.media.syncEntityImages('category', id, urls);
      const next = synced[0] ?? null;
      if (next !== updated.image) {
        return this.prisma.category.update({
          where: { id },
          data: { image: next },
        });
      }
    }

    return updated;
  }

  async remove(id: string) {
    const cat = await this.prisma.category.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Category not found');

    await this.prisma.category.updateMany({
      where: { parentId: id },
      data: { parentId: null },
    });
    await this.media.detachAll('category', id);
    await this.prisma.category.delete({ where: { id } });
    return { message: 'Category deleted' };
  }
}
