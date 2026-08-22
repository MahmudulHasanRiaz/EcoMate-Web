import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MARKETING_PLATFORMS } from './marketing.constants';

@Injectable()
export class MarketingPlatformsService {
  private readonly logger = new Logger(MarketingPlatformsService.name);

  constructor(private prisma: PrismaService) {}

  async ensureDefaults() {
    for (const platform of MARKETING_PLATFORMS) {
      await this.prisma.marketingPlatform.upsert({
        where: { slug: platform.slug },
        update: { name: platform.name, status: 'active' },
        create: { slug: platform.slug, name: platform.name, status: 'active' },
      });
    }
  }

  async list() {
    await this.ensureDefaults();
    return this.prisma.marketingPlatform.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { connections: true } } },
    });
  }
}