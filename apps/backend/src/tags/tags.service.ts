import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
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
    const result = await this.prisma.tag.deleteMany({
      where: { id: { in: ids } },
    });
    return { message: `${result.count} tags deleted` };
  }

  async merge(keepId: string, removeId: string) {
    if (keepId === removeId) {
      throw new BadRequestException('Cannot merge a tag with itself');
    }

    const [keepTag, removeTag] = await Promise.all([
      this.prisma.tag.findUnique({ where: { id: keepId } }),
      this.prisma.tag.findUnique({ where: { id: removeId } }),
    ]);
    if (!keepTag) throw new NotFoundException('Keep tag not found');
    if (!removeTag) throw new NotFoundException('Remove tag not found');

    await this.prisma.$transaction(async (tx) => {
      const existingOnKeep = await tx.productTag.findMany({
        where: { tagId: keepId },
        select: { productId: true },
      });
      const existingOnKeepSet = new Set(existingOnKeep.map((p) => p.productId));

      const toMove = await tx.productTag.findMany({
        where: { tagId: removeId },
      });

      const newProductIds = toMove
        .filter((pt) => !existingOnKeepSet.has(pt.productId))
        .map((pt) => pt.productId);

      if (newProductIds.length > 0) {
        await tx.productTag.createMany({
          data: newProductIds.map((productId) => ({ productId, tagId: keepId })),
        });
        await tx.tag.update({
          where: { id: keepId },
          data: { productCount: { increment: newProductIds.length } },
        });
      }

      await tx.tag.delete({ where: { id: removeId } });
    });

    return { message: 'Tags merged' };
  }
}
