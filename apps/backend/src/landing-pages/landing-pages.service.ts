import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateLandingPageDto, UpdateLandingPageDto } from './dto/landing-page.dto';

@Injectable()
export class LandingPagesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: { page?: number; perPage?: number }) {
    const page = query.page || 1;
    const perPage = query.perPage || 20;
    const [data, total] = await Promise.all([
      this.prisma.landingPage.findMany({
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.landingPage.count(),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findById(id: string) {
    const page = await this.prisma.landingPage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Landing page not found');
    return page;
  }

  async findBySlug(slug: string) {
    return this.prisma.landingPage.findUnique({ where: { slug } });
  }

  async findPublishedBySlug(slug: string) {
    return this.prisma.landingPage.findUnique({
      where: { slug, isActive: true, isDraft: false },
    });
  }

  async create(dto: CreateLandingPageDto) {
    return this.prisma.landingPage.create({
      data: {
        title: dto.title,
        slug: dto.slug,
        pageType: dto.pageType || 'template',
        templateId: dto.templateId,
        sections: dto.sections || [],
        customHtml: dto.customHtml,
        customCss: dto.customCss,
        productIds: dto.productIds || [],
        comboIds: dto.comboIds || [],
        trackingJson: dto.trackingJson || {},
      },
    });
  }

  async update(id: string, dto: UpdateLandingPageDto) {
    const existing = await this.findById(id);
    return this.prisma.landingPage.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.pageType !== undefined && { pageType: dto.pageType }),
        ...(dto.templateId !== undefined && { templateId: dto.templateId }),
        ...(dto.sections !== undefined && { sections: dto.sections }),
        ...(dto.customHtml !== undefined && { customHtml: dto.customHtml }),
        ...(dto.customCss !== undefined && { customCss: dto.customCss }),
        ...(dto.productIds !== undefined && { productIds: dto.productIds }),
        ...(dto.comboIds !== undefined && { comboIds: dto.comboIds }),
        ...(dto.trackingJson !== undefined && { trackingJson: dto.trackingJson }),
      },
    });
  }

  async publish(id: string) {
    await this.findById(id);
    return this.prisma.landingPage.update({
      where: { id },
      data: { isActive: true, isDraft: false, publishedAt: new Date() },
    });
  }

  async unpublish(id: string) {
    await this.findById(id);
    return this.prisma.landingPage.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async remove(id: string) {
    await this.findById(id);
    return this.prisma.landingPage.delete({ where: { id } });
  }
}
