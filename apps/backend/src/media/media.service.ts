import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { createHash } from 'crypto';
import { extname } from 'path';
import { readFile, unlink } from 'fs/promises';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

const PRIVATE_CIDRS: Array<(ip: string) => boolean> = [
  (ip) => ip.startsWith('10.'),
  (ip) => ip.startsWith('127.'),
  (ip) => ip.startsWith('169.254.'),
  (ip) => ip.startsWith('192.168.'),
  (ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip),
  (ip) => ip === '0.0.0.0',
  (ip) => ip === '::1',
  (ip) => ip.startsWith('fc') || ip.startsWith('fd'),
  (ip) => ip.startsWith('fe80:'),
];

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function isLocalUrl(url: string): boolean {
  return /^\/(uploads|api)\//.test(url) || url.startsWith('/uploads/');
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async findAll(query: {
    page?: number;
    perPage?: number;
    search?: string;
    type?: string;
    attached?: string;
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 24;
    const where: any = {};
    if (query.search)
      where.filename = { contains: query.search, mode: 'insensitive' };
    if (query.type === 'image') where.mimeType = { startsWith: 'image/' };
    if (query.type === 'video') where.mimeType = { startsWith: 'video/' };
    if (query.attached === 'yes') where.attachments = { some: {} };
    if (query.attached === 'no') where.attachments = { none: {} };

    const [data, total] = await Promise.all([
      this.prisma.media.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          attachments: { select: { entityType: true, entityId: true } },
          _count: { select: { attachments: true } },
        },
      }),
      this.prisma.media.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const media = await this.prisma.media.findUnique({
      where: { id },
      include: { attachments: true, _count: { select: { attachments: true } } },
    });
    if (!media) throw new NotFoundException('Media not found');
    return media;
  }

  async updateMeta(id: string, dto: { alt?: string }) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media not found');
    return this.prisma.media.update({
      where: { id },
      data: { alt: dto.alt ?? media.alt },
    });
  }

  async getAttachments(id: string) {
    const media = await this.prisma.media.findUnique({
      where: { id },
      include: { attachments: true },
    });
    if (!media) throw new NotFoundException('Media not found');

    const productIds = media.attachments
      .filter((a) => a.entityType === 'product')
      .map((a) => a.entityId);
    const comboIds = media.attachments
      .filter((a) => a.entityType === 'combo')
      .map((a) => a.entityId);
    const categoryIds = media.attachments
      .filter((a) => a.entityType === 'category')
      .map((a) => a.entityId);
    const variantIds = media.attachments
      .filter((a) => a.entityType === 'variant')
      .map((a) => a.entityId);

    type ProductInfo = { id: string; name: string; slug: string };
    type ComboInfo = { id: string; name: string };
    type CategoryInfo = { id: string; name: string };
    type VariantInfo = { id: string; sku: string; product: { name: string } | null };

    const [products, combos, categories, variants] = await Promise.all([
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, slug: true },
          })
        : (Promise.resolve([]) as Promise<ProductInfo[]>),
      comboIds.length
        ? this.prisma.combo.findMany({
            where: { id: { in: comboIds } },
            select: { id: true, name: true },
          })
        : (Promise.resolve([]) as Promise<ComboInfo[]>),
      categoryIds.length
        ? this.prisma.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true },
          })
        : (Promise.resolve([]) as Promise<CategoryInfo[]>),
      variantIds.length
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, sku: true, product: { select: { name: true } } },
          })
        : (Promise.resolve([]) as Promise<VariantInfo[]>),
    ]);

    const productMap = new Map(products.map((p) => [p.id, p]));
    const comboMap = new Map(combos.map((c) => [c.id, c]));
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    const details: {
      entityType: string;
      entityId: string;
      entityName: string;
    }[] = [];
    for (const att of media.attachments) {
      let entityName = att.entityId;
      if (att.entityType === 'product') {
        const p = productMap.get(att.entityId);
        if (p) entityName = p.name;
      } else if (att.entityType === 'combo') {
        const c = comboMap.get(att.entityId);
        if (c) entityName = c.name;
      } else if (att.entityType === 'category') {
        const c = categoryMap.get(att.entityId);
        if (c) entityName = c.name;
      } else if (att.entityType === 'variant') {
        const v = variantMap.get(att.entityId);
        if (v) entityName = `${v.product?.name || ''} (${v.sku})`;
      } else if (att.entityType === 'storefront') {
        entityName = `Storefront · ${att.entityId}`;
      }
      details.push({
        entityType: att.entityType,
        entityId: att.entityId,
        entityName,
      });
    }
    return details;
  }

  async remove(id: string, force = false) {
    const media = await this.prisma.media.findUnique({
      where: { id },
      include: { _count: { select: { attachments: true } } },
    });
    if (!media) throw new NotFoundException('Media not found');

    if (!force && media._count.attachments > 0) {
      throw new ConflictException(
        `Media is attached to ${media._count.attachments} item(s). Detach first or pass ?force=true.`,
      );
    }

    const urlParts = media.url.split('/');
    const filename = urlParts[urlParts.length - 1];
    try {
      await this.storage.delete(filename);
    } catch (err) {
      this.logger.warn(
        `Storage delete failed for ${filename}: ${(err as Error).message}`,
      );
    }
    await this.prisma.media.delete({ where: { id } });

    return { message: 'Media deleted' };
  }

  async bulkRemove(ids: string[], force = false) {
    const results: { id: string; success: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        await this.remove(id, force);
        results.push({ id, success: true });
      } catch (err) {
        results.push({
          id,
          success: false,
          error: (err as Error).message,
        });
      }
    }
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    return { succeeded, failed, results };
  }

  async attach(mediaId: string, entityType: string, entityId: string) {
    return this.prisma.mediaAttachment.upsert({
      where: { mediaId_entityType_entityId: { mediaId, entityType, entityId } },
      create: { mediaId, entityType, entityId },
      update: {},
    });
  }

  async detach(mediaId: string, entityType: string, entityId: string) {
    await this.prisma.mediaAttachment.deleteMany({
      where: { mediaId, entityType, entityId },
    });
    return { message: 'Detached' };
  }

  async detachAll(entityType: string, entityId: string) {
    await this.prisma.mediaAttachment.deleteMany({
      where: { entityType, entityId },
    });
  }

  /**
   * SSRF & protocol validation for arbitrary remote URLs.
   * Blocks loopback, private ranges, link-local, and non-http(s) schemes.
   */
  private async assertSafeRemoteUrl(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException('Invalid URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException('Only http(s) URLs are allowed');
    }

    const host = url.hostname;
    if (!host) throw new BadRequestException('Invalid host');

    const candidates: string[] = [];
    if (isIP(host)) {
      candidates.push(host);
    } else {
      try {
        const records = await lookup(host, { all: true });
        for (const r of records) candidates.push(r.address);
      } catch {
        throw new BadRequestException('Failed to resolve URL host');
      }
    }
    for (const ip of candidates) {
      if (PRIVATE_CIDRS.some((p) => p(ip))) {
        throw new BadRequestException(
          'Refusing to fetch URL pointing to a private or loopback address',
        );
      }
    }
    return url;
  }

  /**
   * Public — used by UploadController.uploadFromUrl AND internal auto-migration.
   * Downloads remote content, deduplicates by sha256 hash, persists to Media library.
   */
  async ingestFromUrl(
    rawUrl: string,
    opts: { filename?: string; alt?: string; uploadedBy?: string } = {},
  ): Promise<{
    id: string;
    url: string;
    filename: string;
    size: number;
    mimeType: string;
  }> {
    const url = await this.assertSafeRemoteUrl(rawUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*;q=0.8,*/*;q=0.5'
        },
      });
    } catch (err) {
      throw new BadRequestException(
        `Failed to fetch URL: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      throw new BadRequestException(`Failed to fetch URL: ${resp.status}`);
    }
    const contentType =
      resp.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ||
      'application/octet-stream';
    if (
      !contentType.startsWith('image/') &&
      !contentType.startsWith('video/')
    ) {
      throw new BadRequestException('URL must point to an image or video');
    }
    const lenHeader = resp.headers.get('content-length');
    const declaredSize = lenHeader ? parseInt(lenHeader, 10) : 0;
    if (declaredSize > 25 * 1024 * 1024) {
      throw new BadRequestException('Remote file too large (>25MB)');
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length > 25 * 1024 * 1024) {
      throw new BadRequestException('Remote file too large (>25MB)');
    }
    const hash = sha256(buffer);

    const existing = await this.prisma.media.findFirst({ where: { hash } });
    if (existing)
      return {
        id: existing.id,
        url: existing.url,
        filename: existing.filename,
        size: existing.size,
        mimeType: existing.mimeType,
      };

    const inferredName =
      opts.filename?.trim() ||
      url.pathname.split('/').pop()?.split('?')[0] ||
      `download${extname(url.pathname) || '.jpg'}`;

    const result = await this.storage.uploadFromBuffer(
      buffer,
      inferredName,
      contentType,
      opts.filename?.trim() || undefined,
    );

    if (!result.filename) throw new BadRequestException('Upload failed: missing filename');
    if (!result.url) throw new BadRequestException('Upload failed: missing url');
    if (!contentType) throw new BadRequestException('Upload failed: missing mimetype');
    if (result.size == null) throw new BadRequestException('Upload failed: missing size');

    this.logger.debug(
      `Creating media from URL: filename="${result.filename}" url="${result.url}" mimeType="${contentType}" size=${result.size} hash=${hash}`,
    );

    const created = await this.prisma.media.create({
      data: {
        filename: result.filename,
        url: result.url,
        mimeType: contentType,
        size: result.size,
        hash,
        alt: opts.alt,
        sourceUrl: rawUrl,
        uploadedBy: opts.uploadedBy,
      },
    });
    return {
      id: created.id,
      url: created.url,
      filename: created.filename,
      size: created.size,
      mimeType: created.mimeType,
    };
  }

  /**
   * Persist a freshly uploaded file (multer) into the Media library with hash dedup.
   * Returns the Media row — caller may reuse an existing row when content matches.
   */
  async ingestFromMulter(
    file: Express.Multer.File,
    opts: { filename?: string; alt?: string; uploadedBy?: string } = {},
  ): Promise<{
    id: string;
    url: string;
    filename: string;
    size: number;
    mimeType: string;
  }> {
    if (!file?.buffer && !file?.path) throw new BadRequestException('No file uploaded');
    if (!file.buffer) {
      file.buffer = await readFile(file.path);
    }
    if (
      !file.mimetype?.startsWith('image/') &&
      !file.mimetype?.startsWith('video/')
    ) {
      throw new BadRequestException('Only images & videos allowed');
    }
    const hash = sha256(file.buffer);
    const existing = await this.prisma.media.findFirst({ where: { hash } });
    if (existing) {
      if (file.path) await unlink(file.path).catch(() => {});
      return {
        id: existing.id,
        url: existing.url,
        filename: existing.filename,
        size: existing.size,
        mimeType: existing.mimeType,
      };
    }

    const result = await this.storage.upload(
      file,
      opts.filename?.trim() || undefined,
    );
    if (file.path) await unlink(file.path).catch(() => {});

    if (!result.filename) throw new BadRequestException('Upload failed: missing filename');
    if (!result.url) throw new BadRequestException('Upload failed: missing url');
    if (!file.mimetype) throw new BadRequestException('Upload failed: missing mimetype');
    if (file.size == null) throw new BadRequestException('Upload failed: missing size');

    this.logger.debug(
      `Creating media: filename="${result.filename}" url="${result.url}" mimeType="${file.mimetype}" size=${file.size} hash=${hash}`,
    );

    const created = await this.prisma.media.create({
      data: {
        filename: result.filename,
        url: result.url,
        mimeType: file.mimetype,
        size: file.size,
        hash,
        alt: opts.alt,
        uploadedBy: opts.uploadedBy,
      },
    });
    return {
      id: created.id,
      url: created.url,
      filename: created.filename,
      size: created.size,
      mimeType: created.mimeType,
    };
  }

  /**
   * Resolve a list of URLs to Media rows.
   *
   * - Library URLs (/uploads/*, absolute backend URLs, or our R2 public URLs):
   *     look up existing Media. If none found, return null — entity will keep
   *     the URL but no attachment will be tracked.
   * - External URLs (anything starting with http(s):// pointing elsewhere):
   *     download via ingestFromUrl, return the new Media row.
   *
   * Returns parallel-array of { url, mediaId | null } where `url` is the
   * canonicalised library URL the caller should persist on the entity.
   */
  async resolveUrlsToMedia(
    urls: string[],
    opts: { uploadedBy?: string } = {},
  ): Promise<{ url: string; mediaId: string | null }[]> {
    const result: { url: string; mediaId: string | null }[] = [];
    for (const raw of urls) {
      if (!raw) continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;

      const fname = trimmed.split('/').pop()?.split('?')[0] || '';
      const known = await this.prisma.media.findFirst({
        where: {
          OR: [{ url: trimmed }, ...(fname ? [{ filename: fname }] : [])],
        },
        select: { id: true, url: true },
      });

      if (known) {
        result.push({ url: known.url, mediaId: known.id });
        continue;
      }

      if (isLocalUrl(trimmed)) {
        // Library-shaped URL but no row yet (e.g. file copied manually into uploads/).
        result.push({ url: trimmed, mediaId: null });
        continue;
      }

      if (/^https?:\/\//i.test(trimmed)) {
        try {
          const ingested = await this.ingestFromUrl(trimmed, {
            uploadedBy: opts.uploadedBy,
          });
          result.push({ url: ingested.url, mediaId: ingested.id });
        } catch (err) {
          this.logger.warn(
            `Auto-migration failed for ${trimmed}: ${(err as Error).message}`,
          );
          result.push({ url: trimmed, mediaId: null });
        }
        continue;
      }

      result.push({ url: trimmed, mediaId: null });
    }
    return result;
  }

  /**
   * Replace the attachment set for an entity with exactly `mediaIds`. Anything
   * else previously attached gets detached so orphans never linger.
   */
  async syncAttachments(
    entityType: string,
    entityId: string,
    mediaIds: string[],
  ) {
    const unique = Array.from(new Set(mediaIds.filter(Boolean)));
    await this.prisma.mediaAttachment.deleteMany({
      where: {
        entityType,
        entityId,
        mediaId: { notIn: unique.length ? unique : ['__none__'] },
      },
    });
    for (const mId of unique) {
      await this.prisma.mediaAttachment.upsert({
        where: {
          mediaId_entityType_entityId: { mediaId: mId, entityType, entityId },
        },
        create: { mediaId: mId, entityType, entityId },
        update: {},
      });
    }
  }

  /**
   * Convenience used by Products/Combos/Categories/SystemSettings on write:
   *   1. Resolves every URL to a Media row (auto-migrating external URLs).
   *   2. Returns the canonical URL list (caller persists it on the entity).
   *   3. Syncs MediaAttachment so the library reflects exactly what is in use.
   */
  async syncEntityImages(
    entityType: string,
    entityId: string,
    urls: string[],
    opts: { uploadedBy?: string } = {},
  ): Promise<string[]> {
    const resolved = await this.resolveUrlsToMedia(urls, opts);
    const mediaIds = resolved
      .map((r) => r.mediaId)
      .filter((id): id is string => !!id);
    await this.syncAttachments(entityType, entityId, mediaIds);
    return resolved.map((r) => r.url);
  }

  /**
   * Admin-callable: scan all known image-bearing entities, download any
   * external URLs into the library, and update entities to reference the
   * library URLs. Idempotent — safe to re-run.
   */
  async migrateOrphans(opts: { uploadedBy?: string } = {}): Promise<{
    scanned: number;
    migrated: number;
    failed: number;
  }> {
    let scanned = 0;
    let migrated = 0;
    let failed = 0;

    const scan = async (
      label: string,
      load: () => Promise<{ id: string; urls: string[] }[]>,
      persist: (id: string, urls: string[]) => Promise<void>,
    ) => {
      const items = await load();
      for (const item of items) {
        scanned += item.urls.length;
        const resolved = await this.resolveUrlsToMedia(item.urls, opts);
        const newUrls = resolved.map((r) => r.url);
        const changed = JSON.stringify(newUrls) !== JSON.stringify(item.urls);
        for (let i = 0; i < item.urls.length; i++) {
          if (item.urls[i] !== resolved[i]?.url) migrated++;
          if (!resolved[i]?.mediaId && /^https?:/i.test(item.urls[i])) failed++;
        }
        if (changed) {
          await persist(item.id, newUrls);
        }
        const mediaIds = resolved
          .map((r) => r.mediaId)
          .filter((id): id is string => !!id);
        await this.syncAttachments(label, item.id, mediaIds);
      }
    };

    await scan(
      'product',
      async () => {
        const list = await this.prisma.product.findMany({
          select: { id: true, images: true },
        });
        return list.map((p) => ({
          id: p.id,
          urls: Array.isArray(p.images) ? (p.images as string[]) : [],
        }));
      },
      async (id, urls) => {
        await this.prisma.product.update({
          where: { id },
          data: { images: urls as any },
        });
      },
    );

    await scan(
      'combo',
      async () => {
        const list = await this.prisma.combo.findMany({
          select: { id: true, image: true, images: true },
        });
        return list.map((c) => ({
          id: c.id,
          urls: [
            ...(c.image ? [c.image] : []),
            ...((Array.isArray(c.images) ? (c.images as string[]) : []) || []),
          ],
        }));
      },
      async (id, urls) => {
        await this.prisma.combo.update({
          where: { id },
          data: { image: urls[0] || null, images: urls.slice(1) as any },
        });
      },
    );

    await scan(
      'category',
      async () => {
        const list = await this.prisma.category.findMany({
          select: { id: true, image: true },
        });
        return list
          .filter((c) => !!c.image)
          .map((c) => ({ id: c.id, urls: [c.image as string] }));
      },
      async (id, urls) => {
        await this.prisma.category.update({
          where: { id },
          data: { image: urls[0] || null },
        });
      },
    );

    await scan(
      'variant',
      async () => {
        const list = await this.prisma.productVariant.findMany({
          select: { id: true, image: true },
        });
        return list
          .filter((v) => !!v.image)
          .map((v) => ({ id: v.id, urls: [v.image as string] }));
      },
      async (id, urls) => {
        await this.prisma.productVariant.update({
          where: { id },
          data: { image: urls[0] || null },
        });
      },
    );

    // Storefront hero slides & secondary banner
    const heroRow = await this.prisma.systemSetting.findUnique({
      where: { key: 'hero_slides' },
    });
    if (heroRow?.value) {
      try {
        const slides: { image: string; link?: string; alt?: string }[] =
          JSON.parse(heroRow.value);
        const urls = slides.map((s) => s.image).filter(Boolean);
        scanned += urls.length;
        const resolved = await this.resolveUrlsToMedia(urls, opts);
        let changed = false;
        const nextSlides = slides.map((s, i) => {
          if (s.image && resolved[i] && s.image !== resolved[i].url) {
            changed = true;
            migrated++;
          }
          return { ...s, image: resolved[i]?.url || s.image };
        });
        if (changed) {
          await this.prisma.systemSetting.update({
            where: { key: 'hero_slides' },
            data: { value: JSON.stringify(nextSlides) },
          });
        }
        const mediaIds = resolved
          .map((r) => r.mediaId)
          .filter((id): id is string => !!id);
        await this.syncAttachments('storefront', 'hero_slides', mediaIds);
      } catch {
        /* ignore malformed */
      }
    }
    const sec = await this.prisma.systemSetting.findUnique({
      where: { key: 'hero_secondary_banner' },
    });
    if (sec?.value) {
      scanned++;
      const [r] = await this.resolveUrlsToMedia([sec.value], opts);
      if (r && r.url !== sec.value) {
        migrated++;
        await this.prisma.systemSetting.update({
          where: { key: 'hero_secondary_banner' },
          data: { value: r.url },
        });
      }
      await this.syncAttachments(
        'storefront',
        'hero_secondary_banner',
        r?.mediaId ? [r.mediaId] : [],
      );
    }

    // Storefront store systems (logo images)
    const sysRow = await this.prisma.systemSetting.findUnique({
      where: { key: 'store_systems' },
    });
    if (sysRow?.value) {
      try {
        const systems: { logo?: string }[] = JSON.parse(sysRow.value);
        const urls = systems.map((s) => s.logo).filter((u): u is string => !!u);
        scanned += urls.length;
        const resolved = await this.resolveUrlsToMedia(urls, opts);
        let changed = false;
        const nextSystems = systems.map((s, i) => {
          if (s.logo && resolved[i] && s.logo !== resolved[i].url) {
            changed = true;
            migrated++;
          }
          return { ...s, logo: resolved[i]?.url || s.logo };
        });
        if (changed) {
          await this.prisma.systemSetting.update({
            where: { key: 'store_systems' },
            data: { value: JSON.stringify(nextSystems) },
          });
        }
        const mediaIds = resolved
          .map((r) => r.mediaId)
          .filter((id): id is string => !!id);
        await this.syncAttachments('storefront', 'store_systems', mediaIds);
      } catch {
        /* ignore malformed */
      }
    }

    // Single-value image URL settings
    for (const key of [
      'storefront_og_image',
      'storefront_favicon',
      'admin_favicon',
    ] as const) {
      const row = await this.prisma.systemSetting.findUnique({
        where: { key },
      });
      if (row?.value) {
        scanned++;
        const [r] = await this.resolveUrlsToMedia([row.value], opts);
        if (r && r.url !== row.value) {
          migrated++;
          await this.prisma.systemSetting.update({
            where: { key },
            data: { value: r.url },
          });
        }
        await this.syncAttachments(
          'storefront',
          key,
          r?.mediaId ? [r.mediaId] : [],
        );
      }
    }

    this.logger.log(
      `Media migration: scanned=${scanned} migrated=${migrated} failed=${failed}`,
    );
    return { scanned, migrated, failed };
  }
}
