import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
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

  async validateToken(
    token: string,
    platform: string,
  ): Promise<{ config: any; tenantId: string }> {
    const config = await this.prisma.productFeedConfig.findFirst({
      where: { secureToken: token, platform, isActive: true },
    });
    if (!config) throw new NotFoundException('Feed not found');

    const licensed = await this.featureFlags.canUse('admin_product_feeds');
    if (!licensed) throw new ForbiddenException('Feature is not licensed');

    return { config, tenantId: config.tenantId };
  }

  async generateFeed(
    token: string,
    platform: string,
    reply: any,
    ipAddress: string,
    userAgent: string,
  ) {
    const { config, tenantId } = await this.validateToken(token, platform);
    const startTime = Date.now();

    const filter = this.buildProductFilter(config);
    const ns = PLATFORM_NAMESPACES[platform] || PLATFORM_NAMESPACES.meta;

    const res = reply.raw || reply;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const gzip = zlib.createGzip();
    gzip.pipe(res);

    let productCount = 0;

    try {
      gzip.write(`<?xml version="1.0" encoding="UTF-8"?>\n`);
      gzip.write(`<rss xmlns:g="${this.escapeXml(ns)}" version="2.0">\n`);
      gzip.write(`  <channel>\n`);
      gzip.write(
        `    <title>Product Catalog — ${this.escapeXml(platform)}</title>\n`,
      );
      gzip.write(
        `    <link>${process.env.STOREFRONT_URL || 'https://yourstore.com'}</link>\n`,
      );
      gzip.write(
        `    <description>Auto-generated product catalog feed for ${this.escapeXml(platform)}</description>\n`,
      );

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
              select: {
                id: true,
                sku: true,
                price: true,
                salePrice: true,
                managedStockQuantity: true,
                reservedStock: true,
                image: true,
              },
            },
          },
        };

        if (lastId) {
          queryOpts.skip = 1;
          queryOpts.cursor = { id: lastId };
        }

        const products = (await this.prisma.product.findMany(
          queryOpts,
        )) as any[];

        await this.enrichProductsWithStock(products);

        if (products.length === 0) break;

        for (const product of products) {
          const images = (product.images as string[]) || [];
          const hasVariants =
            product.type === 'variable' && product.variants.length > 0;

          if (hasVariants) {
            for (const variant of product.variants) {
              gzip.write(
                this.mapToItemXml(
                  {
                    id: variant.sku || `${product.sku}-${variant.id}`,
                    title: `${product.name} - ${variant.sku}`,
                    description: this.stripHtml(
                      product.shortDesc || product.description || '',
                    ),
                    link: `${process.env.STOREFRONT_URL || 'https://yourstore.com'}/product/${product.slug}?variant=${variant.id}`,
                    imageLink: variant.image || images[0] || '',
                    availability:
                      variant._availableStock === null || variant._availableStock > 0
                        ? 'in stock'
                        : 'out of stock',
                    price: variant.price || product.basePrice,
                    salePrice: variant.salePrice || product.salePrice,
                    brand: product.brand?.name || 'Store Brand',
                    itemGroupId: product.id,
                  },
                  platform,
                ),
              );
              productCount++;
            }
          } else {
            gzip.write(
              this.mapToItemXml(
                {
                  id: product.sku || product.id,
                  title: product.name,
                  description: this.stripHtml(
                    product.shortDesc || product.description || '',
                  ),
                  link: `${process.env.STOREFRONT_URL || 'https://yourstore.com'}/product/${product.slug}`,
                  imageLink: images[0] || '',
                  availability:
                    product._availableStock === null || product._availableStock > 0
                      ? 'in stock'
                      : 'out of stock',
                  price: product.basePrice,
                  salePrice: product.salePrice,
                  brand: product.brand?.name || 'Store Brand',
                  itemGroupId: undefined,
                },
                platform,
              ),
            );
            productCount++;
          }
        }

        lastId = products[products.length - 1].id;
      }

      gzip.write(`  </channel>\n`);
      gzip.write(`</rss>`);
      gzip.end();
    } catch (err) {
      gzip.destroy(err);
      throw err;
    }

    const durationMs = Date.now() - startTime;
    await this.logAccess(tenantId, platform, durationMs, ipAddress, userAgent);
    await this.prisma.productFeedConfig.update({
      where: { id: config.id },
      data: { lastFetchedAt: new Date() },
    });
  }

  private async enrichProductsWithStock(products: any[]): Promise<void> {
    if (products.length === 0) return;

    const variantIds = new Set<string>();
    const productIds = new Set<string>();
    for (const p of products) {
      productIds.add(p.id);
      if (p.type === 'variable' && p.variants?.length) {
        for (const v of p.variants) {
          variantIds.add(v.id);
        }
      }
    }

    const inventoryRows = await this.prisma.physicalInventory.findMany({
      where: {
        OR: [
          { productId: { in: Array.from(productIds) }, variantId: null },
          { variantId: { in: Array.from(variantIds) } },
        ],
      },
      select: {
        productId: true,
        variantId: true,
        quantity: true,
        reservedQuantity: true,
      },
    });

    const invByProduct = new Map<string, { qty: number; reserved: number }>();
    const invByVariant = new Map<string, { qty: number; reserved: number }>();
    for (const row of inventoryRows) {
      if (row.variantId) {
        const cur = invByVariant.get(row.variantId) ?? { qty: 0, reserved: 0 };
        cur.qty += row.quantity;
        cur.reserved += row.reservedQuantity;
        invByVariant.set(row.variantId, cur);
      } else {
        const cur = invByProduct.get(row.productId) ?? { qty: 0, reserved: 0 };
        cur.qty += row.quantity;
        cur.reserved += row.reservedQuantity;
        invByProduct.set(row.productId, cur);
      }
    }

    for (const p of products) {
      const phys = invByProduct.get(p.id);

      p._availableStock =
        p.availabilityMode === 'ALWAYS_IN_STOCK'
          ? null
          : p.availabilityMode === 'ALWAYS_OUT_OF_STOCK'
            ? 0
            : p.availabilityMode === 'INVENTORY_CONTROLLED'
              ? (phys?.qty ?? 0) - (phys?.reserved ?? 0)
              : // MANAGED_STOCK (default)
                (p.type === 'variable'
                  ? (p.variants ?? []).reduce(
                      (sum: number, v: any) =>
                        sum + (v.managedStockQuantity ?? 0),
                      0,
                    )
                  : (p.managedStockQuantity ?? 0)) -
                  (p.reservedStock ?? 0);

      if (p.variants) {
        for (const v of p.variants) {
          const vPhys = invByVariant.get(v.id);
          v._availableStock =
            p.availabilityMode === 'ALWAYS_IN_STOCK'
              ? null
              : p.availabilityMode === 'ALWAYS_OUT_OF_STOCK'
                ? 0
                : p.availabilityMode === 'INVENTORY_CONTROLLED'
                  ? (vPhys?.qty ?? 0) - (vPhys?.reserved ?? 0)
                  : // MANAGED_STOCK
                    (v.managedStockQuantity ?? 0) - (v.reservedStock ?? 0);
        }
      }
    }
  }

  private buildProductFilter(config: any): any {
    const filter: any = { isActive: true };

    if (config.excludeOutOfStock) {
      filter.OR = [
        { availabilityMode: 'ALWAYS_IN_STOCK' as any },
        {
          availabilityMode: 'MANAGED_STOCK' as any,
          type: 'simple',
          managedStockQuantity: { gt: 0 },
        },
        {
          availabilityMode: 'MANAGED_STOCK' as any,
          type: 'variable',
          variants: {
            some: { managedStockQuantity: { gt: 0 } },
          },
        },
      ];
    }

    if (config.minPriceFilter) {
      filter.basePrice = { gte: config.minPriceFilter };
    }

    return filter;
  }

  private mapToItemXml(p: any, platform: string): string {
    const e = (s: any) => this.escapeXml(String(s ?? ''));

    return (
      `    <item>\n` +
      `      <g:id>${e(p.id)}</g:id>\n` +
      `      <g:title>${e(p.title)}</g:title>\n` +
      `      <g:description>${e(p.description)}</g:description>\n` +
      `      <g:link>${e(p.link)}</g:link>\n` +
      `      <g:image_link>${e(p.imageLink)}</g:image_link>\n` +
      `      <g:availability>${p.availability}</g:availability>\n` +
      `      <g:price>${e(p.price)} BDT</g:price>\n` +
      (p.salePrice
        ? `      <g:sale_price>${e(p.salePrice)} BDT</g:sale_price>\n`
        : '') +
      `      <g:brand>${e(p.brand)}</g:brand>\n` +
      `      <g:condition>new</g:condition>\n` +
      (p.itemGroupId
        ? `      <g:item_group_id>${e(p.itemGroupId)}</g:item_group_id>\n`
        : '') +
      `    </item>\n`
    );
  }

  private async logAccess(
    tenantId: string,
    platform: string,
    durationMs: number,
    ipAddress: string,
    userAgent: string,
  ) {
    await this.prisma.productFeedLog
      .create({
        data: {
          tenantId,
          platform,
          ipAddress,
          userAgent,
          statusCode: 200,
          durationMs,
        },
      })
      .catch(() => {});
  }

  // -- Admin methods --

  async listConfigs() {
    return this.prisma.productFeedConfig.findMany({
      orderBy: { platform: 'asc' },
    });
  }

  async createConfig(dto: any) {
    const existing = await this.prisma.productFeedConfig.findFirst({
      where: { platform: dto.platform },
    });
    if (existing)
      throw new BadRequestException(
        `Feed config for ${dto.platform} already exists`,
      );

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
    const allowed: any = {};
    if (dto.isActive !== undefined) allowed.isActive = dto.isActive;
    if (dto.excludeOutOfStock !== undefined) allowed.excludeOutOfStock = dto.excludeOutOfStock;
    if (dto.minPriceFilter !== undefined) allowed.minPriceFilter = dto.minPriceFilter;
    return this.prisma.productFeedConfig.update({
      where: { id },
      data: allowed,
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
