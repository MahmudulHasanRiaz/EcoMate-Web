import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCmsPageDto, UpdateCmsPageDto } from './dto/cms-page.dto';

@Injectable()
export class CmsPagesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.cmsPage.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findActiveForFooter() {
    return this.prisma.cmsPage.findMany({
      where: { isActive: true, showInFooter: true },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      select: { id: true, slug: true, title: true },
    });
  }

  async findOne(id: string) {
    const page = await this.prisma.cmsPage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  async findBySlug(slug: string) {
    const page = await this.prisma.cmsPage.findUnique({ where: { slug } });
    if (!page || !page.isActive) throw new NotFoundException('Page not found');
    return page;
  }

  async create(dto: CreateCmsPageDto) {
    const existing = await this.prisma.cmsPage.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) throw new ConflictException('Slug already exists');
    return this.prisma.cmsPage.create({ data: dto as any });
  }

  async update(id: string, dto: UpdateCmsPageDto) {
    const page = await this.prisma.cmsPage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');

    if (dto.slug && dto.slug !== page.slug) {
      const exist = await this.prisma.cmsPage.findUnique({
        where: { slug: dto.slug },
      });
      if (exist) throw new ConflictException('Slug already exists');
    }

    return this.prisma.cmsPage.update({
      where: { id },
      data: dto as any,
    });
  }

  async remove(id: string) {
    const page = await this.prisma.cmsPage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');
    await this.prisma.cmsPage.delete({ where: { id } });
    return { message: 'Page deleted' };
  }
}
