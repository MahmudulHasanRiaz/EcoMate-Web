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
import { MediaResolverService } from '../media/media-resolver.service';
import {
  extractUploadImagePaths,
  rewriteUploadImages,
} from '../media/html-image-rewrite';

@Injectable()
export class CmsPagesService implements OnModuleInit {
  private readonly logger = new Logger(CmsPagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaResolver: MediaResolverService,
  ) {}

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
    // Public read path ONLY: embedded <img> tags pointing at original
    // uploads are rewritten to derivatives (see html-image-rewrite), and
    // the structured config's image fields get their derivative manifests
    // attached as config._mediaMeta so the page templates can serve a
    // derivative instead of the raw original (the About hero did the
    // latter — verified live 2026-11-04). The stored row is never
    // modified — findOne (admin edit) keeps returning it verbatim.
    return {
      ...page,
      content: await this.rewriteContentImages(page.content),
      config: await this.attachConfigMediaMeta(page.config),
    };
  }

  /**
   * Collect every upload URL referenced anywhere in the page config JSON
   * (hero images, section images — the templates' structured fields),
   * resolve their derivative manifests and attach them as `_mediaMeta`
   * on a response-only copy of the config. Mirrors the storefront-config
   * pattern for hero/logo imagery. Failure-safe: any error returns the
   * stored config unchanged (templates fall back to the original URL).
   */
  private async attachConfigMediaMeta(config: unknown): Promise<unknown> {
    if (!config || typeof config !== 'object') return config;
    try {
      const urls: string[] = [];
      const walk = (v: unknown): void => {
        if (typeof v === 'string') {
          if (v.includes('/uploads/')) urls.push(v);
        } else if (Array.isArray(v)) {
          v.forEach(walk);
        } else if (v && typeof v === 'object') {
          Object.values(v as Record<string, unknown>).forEach(walk);
        }
      };
      walk(config);
      if (urls.length === 0) return config;
      const map = await this.mediaResolver.resolve(urls);
      if (Object.keys(map).length === 0) return config;
      return { ...(config as Record<string, unknown>), _mediaMeta: map };
    } catch (e) {
      this.logger.warn(`CMS config media-meta attach failed: ${e}`);
      return config;
    }
  }

  private async rewriteContentImages(content: string): Promise<string> {
    try {
      const paths = extractUploadImagePaths(content ?? '');
      if (paths.length === 0) return content;
      const map = await this.mediaResolver.resolve(paths);
      return rewriteUploadImages(content, map);
    } catch (e) {
      // A rewrite failure must never take a public page down — serve the
      // stored HTML as-is (originals as fallback) and log it.
      this.logger.warn(`CMS content image rewrite failed: ${e}`);
      return content;
    }
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
