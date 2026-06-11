import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.tag.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  async findOne(id: string) {
    const tag = await this.prisma.tag.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!tag) throw new NotFoundException('Tag not found');
    return tag;
  }

  async create(dto: { name: string; slug: string }) {
    const existing = await this.prisma.tag.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) throw new ConflictException('Tag slug already exists');
    return this.prisma.tag.create({ data: dto });
  }

  async update(id: string, dto: { name?: string; slug?: string }) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('Tag not found');
    if (dto.slug) {
      const existing = await this.prisma.tag.findUnique({
        where: { slug: dto.slug },
      });
      if (existing && existing.id !== id)
        throw new ConflictException('Tag slug already exists');
    }
    return this.prisma.tag.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('Tag not found');
    await this.prisma.tag.delete({ where: { id } });
    return { message: 'Tag deleted' };
  }

  async bulkDelete(ids: string[]) {
    await this.prisma.tag.deleteMany({ where: { id: { in: ids } } });
    return { message: `${ids.length} tags deleted` };
  }

  async merge(keepId: string, removeId: string) {
    const productsToMove = await this.prisma.productTag.findMany({
      where: { tagId: removeId },
    });
    for (const pt of productsToMove) {
      await this.prisma.productTag.upsert({
        where: { productId_tagId: { productId: pt.productId, tagId: keepId } },
        update: {},
        create: { productId: pt.productId, tagId: keepId },
      });
    }
    await this.prisma.tag.delete({ where: { id: removeId } });
    return { message: 'Tags merged' };
  }
}
