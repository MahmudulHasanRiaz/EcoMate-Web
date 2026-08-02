import {
  Injectable,
  NotFoundException,
  ConflictException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCmsPageDto, UpdateCmsPageDto } from './dto/cms-page.dto';
import { templatePages } from './template-pages';

@Injectable()
export class CmsPagesService implements OnModuleInit {
  private readonly logger = new Logger(CmsPagesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureTemplatePages();
  }

  /**
   * Idempotent backfill: creates the fixed "system pages" (careers, about,
   * contact, ...) as CmsPage rows of type 'template' so admins can toggle and
   * edit them from the Pages menu. Existing live page content that currently
   * lives in SystemSetting is copied into the config on first creation.
   */
  async ensureTemplatePages() {
    for (const def of templatePages) {
      const existing = await this.prisma.cmsPage.findUnique({
        where: { slug: def.slug },
      });
      if (existing) continue;
      try {
        const config = await this.migrateTemplateConfig(def);
        await this.prisma.cmsPage.create({
          data: {
            slug: def.slug,
            title: def.title,
            content: '',
            type: 'template',
            templateKey: def.key,
            isActive: true,
            config,
          },
        });
        this.logger.log(`Created system page "${def.slug}"`);
      } catch (e) {
        this.logger.warn(`Failed to create system page "${def.slug}": ${e}`);
      }
    }
  }

  private async migrateTemplateConfig(def: {
    key: string;
    slug: string;
    title: string;
    defaultConfig: Record<string, any>;
    settingsKeys?: Record<string, string[]>;
  }): Promise<Record<string, any>> {
    const config = { ...def.defaultConfig };
    const keyMap = def.settingsKeys;
    if (!keyMap) return config;
    const keys = Object.keys(keyMap);
    if (keys.length === 0) return config;
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map(r => [r.key, r.value]));
    for (const [configField, settingKeys] of Object.entries(keyMap)) {
      for (const sk of settingKeys) {
        const raw = map.get(sk);
        if (raw === undefined || raw === null || raw === '') continue;
        let value: any = raw;
        // JSON-encoded settings (faq_items, hours_details) are stored as strings
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed === 'object') value = parsed;
        } catch {
          /* plain string */
        }
        (config as any)[configField] = value;
        break;
      }
    }
    return config;
  }

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
    if (!page) throw new NotFoundException('Page not found');
    if (!page.isActive) throw new NotFoundException('Page is not active');
    return page;
  }

  async create(dto: CreateCmsPageDto) {
    const existing = await this.prisma.cmsPage.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) throw new ConflictException('Slug already exists');
    return this.prisma.cmsPage.create({ data: { ...dto } });
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
      data: { ...dto },
    });
  }

  async remove(id: string) {
    const page = await this.prisma.cmsPage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');
    await this.prisma.cmsPage.delete({ where: { id } });
    return { message: 'Page deleted' };
  }
}
