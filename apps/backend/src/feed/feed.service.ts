import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import * as zlib from 'zlib';
import * as crypto from 'crypto';

const PLATFORM_NAMESPACES: Record<string, string> = {
  meta: 'http://base.google.com/ns/1.0',
  google: 'http://base.google.com/ns/1.0',
  tiktok: 'http://base.google.com/ns/1.0',
};

@Injectable()
export class FeedService {
  private readonly CHUNK_SIZE = 250;

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  private escapeXml(str: string): string {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private stripHtml(str?: string): string {
    if (!str) return '';
    return str.replace(/<[^>]*>/g, '').trim();
  }

  async validateToken(token: string, platform: string): Promise<{ config: any; tenantId: string }> {
    const config = await this.prisma.productFeedConfig.findFirst({
      where: { secureToken: token, platform, isActive: true },
    });
    if (!config) throw new NotFoundException('Feed not found');

    const licensed = await this.featureFlags.canUse('admin_product_feeds');
    if (!licensed) throw new ForbiddenException('Feature is not licensed');

    return { config, tenantId: config.tenantId };
  }

  async generateFeed(token: string, platform: string, reply: any) {
    const { config, tenantId } = await this.validateToken(token, platform);
    const startTime = Date.now();

    const filter = await this.buildProductFilter(config);
    const ns = PLATFORM_NAMESPACES[platform] || PLATFORM_NAMESPACES.meta;

    const res = reply.raw || reply;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const gzip = zlib.createGzip();
    gzip.pipe(res);

    let productCount = 0;

    try {
      gzip.write(`<?xml version="1.0" encoding="UTF-8"?>\n`);
      gzip.write(`<rss xmlns:g="${this.escapeXml(ns)}" version="2.0">\n`);
      gzip.write(`  <channel>\n`);
      gzip.write(`    <title>Product Catalog — ${this.escapeXml(platform)}</title>\n`);
      gzip.write(`    <link>${process.env.STOREFRONT_URL || 'https://yourstore.com'}</link>\n`);
      gzip.write(`    <description>Auto-generated product catalog feed for ${this.escapeXml(platform)}</description>\n`);

      let lastId: string | undefined;
      const chunkSize = this.CHUNK_SIZE;

      while (true) {
        const queryOpts: any = {
          take: chunkSize,
          orderBy: { id: 'asc' as const },
          where: filter,
          include: {
            brand: { select: { name: true } },
            variants: {
              where: { isActive: true },
              select: { id: true, sku: true, price: true, salePrice: true, stock: true, image: true },
            },
          },
        };

        if (lastId) {
          queryOpts.skip = 1;
          queryOpts.cursor = { id: lastId };
        }

        const products = await this.prisma.product.findMany(queryOpts) as any[];

        if (products.length === 0) break;

        for (const product of products) {
          const images = (product.images as string[]) || [];
          const hasVariants = product.type === 'variable' && product.variants.length > 0;

          if (hasVariants) {
            for (const variant of product.variants) {
              gzip.write(this.mapToItemXml({
                id: variant.sku || `${product.sku}-${variant.id}`,
                title: `${product.name} - ${variant.sku}`,
                description: this.stripHtml(product.shortDesc || product.description || ''),
                link: `${process.env.STOREFRONT_URL || 'https://yourstore.com'}/product/${product.slug}?variant=${variant.id}`,
                imageLink: variant.image || images[0] || '',
                availability: variant.stock > 0 ? 'in stock' : 'out of stock',
                price: variant.price || product.basePrice,
                salePrice: variant.salePrice || product.salePrice,
                brand: product.brand?.name || 'Store Brand',
                itemGroupId: product.id,
              }, platform));
              productCount++;
            }
          } else {
            gzip.write(this.mapToItemXml({
              id: product.sku || product.id,
              title: product.name,
              description: this.stripHtml(product.shortDesc || product.description || ''),
              link: `${process.env.STOREFRONT_URL || 'https://yourstore.com'}/product/${product.slug}`,
              imageLink: images[0] || '',
              availability: product.stock > 0 ? 'in stock' : 'out of stock',
              price: product.basePrice,
              salePrice: product.salePrice,
              brand: product.brand?.name || 'Store Brand',
              itemGroupId: undefined,
            }, platform));
            productCount++;
          }
        }

        lastId = products[products.length - 1].id;
      }

      gzip.write(`  </channel>\n`);
      gzip.write(`</rss>`);
      gzip.end();
    } catch (err) {
      gzip.destroy(err as any);
      throw err;
    }

    const durationMs = Date.now() - startTime;
    await this.logAccess(tenantId, platform, durationMs);
    await this.prisma.productFeedConfig.update({
      where: { id: config.id },
      data: { lastFetchedAt: new Date() },
    });
  }

  private async buildProductFilter(config: any): Promise<any> {
    const filter: any = { isActive: true };

    if (config.excludeOutOfStock) {
      filter.stock = { gt: 0 };
    }

    if (config.minPriceFilter) {
      filter.basePrice = { gte: config.minPriceFilter };
    }

    return filter;
  }

  private mapToItemXml(p: any, platform: string): string {
    const e = (s: any) => this.escapeXml(String(s ?? ''));

    return `    <item>\n` +
      `      <g:id>${e(p.id)}</g:id>\n` +
      `      <g:title>${e(p.title)}</g:title>\n` +
      `      <g:description>${e(p.description)}</g:description>\n` +
      `      <g:link>${e(p.link)}</g:link>\n` +
      `      <g:image_link>${e(p.imageLink)}</g:image_link>\n` +
      `      <g:availability>${p.availability}</g:availability>\n` +
      `      <g:price>${e(p.price)} BDT</g:price>\n` +
      (p.salePrice ? `      <g:sale_price>${e(p.salePrice)} BDT</g:sale_price>\n` : '') +
      `      <g:brand>${e(p.brand)}</g:brand>\n` +
      `      <g:condition>new</g:condition>\n` +
      (p.itemGroupId ? `      <g:item_group_id>${e(p.itemGroupId)}</g:item_group_id>\n` : '') +
      `    </item>\n`;
  }

  private async logAccess(tenantId: string, platform: string, durationMs: number) {
    await this.prisma.productFeedLog.create({
      data: {
        tenantId,
        platform,
        ipAddress: '0.0.0.0',
        userAgent: 'feed-generator',
        statusCode: 200,
        durationMs,
      },
    }).catch(() => {});
  }

  // -- Admin methods --

  async listConfigs() {
    return this.prisma.productFeedConfig.findMany({ orderBy: { platform: 'asc' } });
  }

  async createConfig(dto: any) {
    const existing = await this.prisma.productFeedConfig.findFirst({
      where: { platform: dto.platform },
    });
    if (existing) throw new BadRequestException(`Feed config for ${dto.platform} already exists`);

    const token = crypto.randomBytes(32).toString('hex');
    return this.prisma.productFeedConfig.create({
      data: {
        tenantId: 'default',
        platform: dto.platform,
        secureToken: token,
        excludeOutOfStock: dto.excludeOutOfStock ?? false,
        minPriceFilter: dto.minPriceFilter,
      },
    });
  }

  async updateConfig(id: string, dto: any) {
    return this.prisma.productFeedConfig.update({
      where: { id },
      data: dto,
    });
  }

  async regenerateToken(id: string) {
    const token = crypto.randomBytes(32).toString('hex');
    return this.prisma.productFeedConfig.update({
      where: { id },
      data: { secureToken: token },
    });
  }

  async getLogs(platform?: string) {
    const where: any = {};
    if (platform) where.platform = platform;
    return this.prisma.productFeedLog.findMany({
      where,
      orderBy: { fetchedAt: 'desc' },
      take: 100,
    });
  }
}
