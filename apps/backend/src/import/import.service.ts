import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import * as Papa from 'papaparse';
import slugify from './utils/slugify';
import {
  WooCommerceCsvRow,
  ParsedCategory,
  ImportError,
  ImportSummary,
} from './types/woocommerce-csv.types';

interface CsvRowWithMeta {
  rowNumber: number;
  data: WooCommerceCsvRow;
}

interface ResolvedAttrs {
  name: string;
  values: Array<{ id: string; value: string }>;
}

interface CachedAttribute {
  id: string;
  values: Map<string, string>; // value.toLowerCase() -> id
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async importFromCsv(
    csvContent: string,
    opts: {
      mode?: 'create' | 'update';
      dryRun?: boolean;
      onProgress?: (processed: number) => void;
    } = {},
  ): Promise<{
    summary: ImportSummary;
    errors: ImportError[];
  }> {
    const mode = opts.mode || 'create';
    const dryRun = opts.dryRun || false;

    const parsed = Papa.parse<WooCommerceCsvRow>(csvContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    const criticalErrors = parsed.errors.filter(
      (e) => e.code !== 'TooFewFields' && e.code !== 'TooManyFields',
    );
    if (criticalErrors.length > 0) {
      const msg = criticalErrors[0].message;
      throw new BadRequestException(`CSV parse error: ${msg}`);
    }

    const nonCriticalErrors = parsed.errors.filter(
      (e) => e.code === 'TooFewFields' || e.code === 'TooManyFields',
    );
    if (nonCriticalErrors.length > 0) {
      this.logger.warn(
        `CSV non-critical warnings: ${nonCriticalErrors.map((e) => `row ${e.row}: ${e.message}`).join('; ')}`,
      );
    }

    const headers = parsed.meta?.fields || [];
    this.logger.log(`CSV headers (${headers.length}): ${headers.join(', ')}`);

    const rows: CsvRowWithMeta[] = parsed.data
      .map((data, i) => {
        const row = { rowNumber: i + 2, data };
        const sku = data.SKU?.trim();
        const type = (data.Type || 'simple').toLowerCase().trim();
        const isVariation = type.includes('variation');
        if (!sku && !isVariation && data.ID?.trim()) {
          data.SKU = `WOO-ID-${data.ID.trim()}`;
        } else if (sku) {
          data.SKU = sku;
        }
        return row;
      })
      .filter((r) => r.data.SKU?.trim());

    if (rows.length === 0) {
      throw new BadRequestException('No rows with SKU or ID found in CSV');
    }

    const summary: ImportSummary = {
      productsCreated: 0,
      productsUpdated: 0,
      productsSkipped: 0,
      categoriesCreated: 0,
      categoriesReused: 0,
      tagsCreated: 0,
      tagsReused: 0,
      attributesImported: 0,
      variantsImported: 0,
      imagesDownloaded: 0,
      imagesImported: 0,
      imagesReused: 0,
      imagesFailed: 0,
      errors: 0,
    };

    const allErrors: ImportError[] = [];

    const groups = this.groupByParent(rows);
    this.logger.log(
      `Grouped ${rows.length} row(s) into ${Object.keys(groups).length} group(s)`,
    );

    if (dryRun) {
      return { summary, errors: allErrors };
    }

    // --- Preload Caches to avoid DB lookups inside loops ---
    this.logger.log('Preloading DB tables into local cache maps...');

    // 1. Categories
    const categories = await this.prisma.category.findMany();
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const getCategoryPath = (catId: string | null): string => {
      if (!catId) return '';
      const parts: string[] = [];
      let currentId: string | null = catId;
      while (currentId) {
        const cat = categoryMap.get(currentId);
        if (!cat) break;
        parts.unshift(cat.name);
        currentId = cat.parentId;
      }
      return parts.join(' > ');
    };
    const categoryCacheByPath = new Map<string, string>();
    for (const cat of categories) {
      const path = getCategoryPath(cat.id);
      categoryCacheByPath.set(path, cat.id);
    }

    // 2. Tags
    const tags = await this.prisma.tag.findMany();
    const tagCache = new Map(tags.map((t) => [t.slug, t.id]));

    // 2.5. Brands
    const brands = await this.prisma.brand.findMany();
    const brandCache = new Map(brands.map((b) => [b.slug, b.id]));

    // 3. Attributes and values
    const attributes = await this.prisma.attribute.findMany({
      include: { values: true },
    });
    const attributeCache = new Map<string, CachedAttribute>();
    for (const attr of attributes) {
      const valMap = new Map<string, string>();
      for (const v of attr.values) {
        valMap.set(v.value.toLowerCase(), v.id);
      }
      attributeCache.set(attr.name.toLowerCase(), {
        id: attr.id,
        values: valMap,
      });
    }

    // 4. Media URLs
    const mediaItems = await this.prisma.media.findMany({
      where: { sourceUrl: { not: null } },
      select: { sourceUrl: true, url: true },
    });
    const mediaCache = new Map<string, string>();
    for (const m of mediaItems) {
      if (m.sourceUrl) {
        mediaCache.set(m.sourceUrl.trim(), m.url);
      }
    }

    // 5. Products (SKUs and Slugs)
    const dbProducts = await this.prisma.product.findMany({
      select: { id: true, sku: true, slug: true },
    });
    const productCache = new Map<string, string>();
    const slugSet = new Set<string>();
    for (const p of dbProducts) {
      if (p.sku) productCache.set(p.sku.trim(), p.id);
      if (p.slug) slugSet.add(p.slug);
    }

    // 6. Variants
    const dbVariants = await this.prisma.productVariant.findMany({
      select: { id: true, sku: true },
    });
    const variantCache = new Map<string, string>();
    for (const v of dbVariants) {
      if (v.sku) variantCache.set(v.sku.trim(), v.id);
    }

    this.logger.log('Caching completed. Starting import processing...');

    let processedCount = 0;
    const groupEntries = Object.entries(groups);

    for (const [groupKey, group] of groupEntries) {
      if (!groupKey) continue;

      // Skip orphan variation groups:
      // If none of the rows in the group are a parent (i.e. all are variations),
      // AND this product doesn't already exist in the DB, it's an orphan.
      const hasParentRow = group.some((r) => {
        const type = (r.data.Type || 'simple').toLowerCase().trim();
        return !type.includes('variation');
      });
      if (!hasParentRow && !productCache.has(groupKey)) {
        this.logger.warn(
          `Skipping group ${groupKey}: contains only variations but no parent row exists in CSV or Database.`,
        );
        allErrors.push({
          rowNumber: group[0].rowNumber,
          sku: groupKey,
          errorType: 'ORPHAN_VARIATIONS',
          message:
            'Skipped orphan variations because no parent product exists.',
        });
        summary.errors++;
        continue;
      }

      try {
        await this.processProductGroupCached(
          groupKey,
          group,
          mode,
          summary,
          allErrors,
          categoryCacheByPath,
          tagCache,
          brandCache,
          attributeCache,
          mediaCache,
          productCache,
          variantCache,
          slugSet,
        );
      } catch (err) {
        const error = err as Error;
        const msg = error.message;
        const stack = error.stack || '';
        this.logger.error(
          `Group processing failed for ${groupKey}: ${msg}\n${stack}`,
        );
        allErrors.push({
          rowNumber: group[0].rowNumber,
          sku: groupKey,
          errorType: 'GROUP_PROCESSING_FAILED',
          message: `${msg}${process.env.NODE_ENV === 'development' ? ` (see server logs)` : ''}`,
        });
        summary.errors++;
      }

      processedCount++;
      if (opts.onProgress) {
        opts.onProgress(processedCount);
      }

      // Yield event loop to allow concurrent requests to run
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    summary.imagesDownloaded = summary.imagesImported + summary.imagesReused;

    return { summary, errors: allErrors };
  }

  private groupByParent(
    rows: CsvRowWithMeta[],
  ): Record<string, CsvRowWithMeta[]> {
    const idToSku: Record<string, string> = {};
    for (const row of rows) {
      const csvId = row.data.ID?.trim();
      const sku = row.data.SKU!.trim();
      if (csvId && sku) {
        idToSku[csvId] = sku;
      }
    }

    const groups: Record<string, CsvRowWithMeta[]> = {};

    for (const row of rows) {
      const sku = row.data.SKU!.trim();
      const type = (row.data.Type || 'simple').toLowerCase().trim();
      const parentVal = row.data.Parent?.trim() || '';

      if (type.includes('variation') && parentVal) {
        let resolvedParentSku = parentVal;
        if (/^id:/i.test(parentVal)) {
          const cleanParentId = parentVal.replace(/^id:/i, '').trim();
          resolvedParentSku = idToSku[cleanParentId] || cleanParentId;
        }
        if (!groups[resolvedParentSku]) groups[resolvedParentSku] = [];
        groups[resolvedParentSku].push(row);
      } else {
        if (!groups[sku]) groups[sku] = [];
        groups[sku].push(row);
      }
    }

    return groups;
  }

  private async processProductGroupCached(
    groupKey: string,
    rows: CsvRowWithMeta[],
    mode: 'create' | 'update',
    summary: ImportSummary,
    errors: ImportError[],
    categoryCacheByPath: Map<string, string>,
    tagCache: Map<string, string>,
    brandCache: Map<string, string>,
    attributeCache: Map<string, CachedAttribute>,
    mediaCache: Map<string, string>,
    productCache: Map<string, string>,
    variantCache: Map<string, string>,
    slugSet: Set<string>,
  ): Promise<void> {
    const parentRow =
      rows.find(
        (r) => !(r.data.Type || 'simple').toLowerCase().includes('variation'),
      ) || rows[0];

    const variationRows = rows.filter((r) =>
      (r.data.Type || 'simple').toLowerCase().includes('variation'),
    );

    const parentSku = parentRow.data.SKU!.trim();
    const existingProductId = productCache.get(parentSku);

    if (existingProductId && mode === 'create') {
      this.logger.log(`Skipping existing SKU: ${parentSku} (create mode)`);
      summary.productsSkipped++;
      return;
    }

    let productId: string;
    const hasVariations = variationRows.length > 0;

    if (existingProductId) {
      await this.updateProductCached(
        existingProductId,
        parentRow,
        summary,
        errors,
        categoryCacheByPath,
        tagCache,
        brandCache,
        mediaCache,
        productCache,
        slugSet,
      );
      productId = existingProductId;
    } else {
      productId = await this.createProductCached(
        parentRow,
        summary,
        errors,
        { skipVariantGeneration: hasVariations },
        categoryCacheByPath,
        tagCache,
        brandCache,
        attributeCache,
        mediaCache,
        productCache,
        slugSet,
      );
    }

    this.logger.log(
      `Product ${parentSku}: ${variationRows.length} variation(s) to process`,
    );

    for (const vRow of variationRows) {
      await this.processVariationCached(
        productId,
        parentSku,
        vRow,
        mode,
        summary,
        errors,
        attributeCache,
        mediaCache,
        variantCache,
      );
    }
  }

  private async createProductCached(
    row: CsvRowWithMeta,
    summary: ImportSummary,
    errors: ImportError[],
    options: { skipVariantGeneration?: boolean },
    categoryCacheByPath: Map<string, string>,
    tagCache: Map<string, string>,
    brandCache: Map<string, string>,
    attributeCache: Map<string, CachedAttribute>,
    mediaCache: Map<string, string>,
    productCache: Map<string, string>,
    slugSet: Set<string>,
  ): Promise<string> {
    const data = row.data;
    const sku = data.SKU!.trim();
    const type = (data.Type || 'simple').toLowerCase().trim();
    const isVariable = type === 'variable' || type === 'variable-subscription';

    const categories = this.parseCategories(data.Categories);
    const tags = this.parseTags(data.Tags);
    const tagIds =
      tags.length > 0
        ? await this.resolveTagsCached(tags, summary, tagCache)
        : [];
    const images = this.parseImages(data.Images);

    const brandName = this.parseBrand(data.Brands);
    let brandId: string | undefined = undefined;
    if (brandName) {
      brandId = await this.resolveBrandCached(brandName, brandCache);
    }

    const categoryId = await this.resolveCategoriesCached(
      categories,
      summary,
      categoryCacheByPath,
    );

    const name = data.Name?.trim() || sku;
    const slug =
      data.Slug?.trim() || this.uniqueSlugCached(slugify(name), slugSet);

    const basePrice = this.parsePrice(data['Regular price']) ?? 0;
    const salePrice = this.parsePrice(data['Sale price']);
    const parsedStock = this.parseInt(data.Stock);
    const manageStock =
      !isVariable && parsedStock !== undefined && parsedStock > 0;
    const stock = manageStock ? parsedStock : 0;
    const seoMeta = this.buildSeoMeta(data);

    // WooCommerce-compatible stock status
    if (parsedStock !== undefined && parsedStock <= 0) {
      seoMeta.stockStatus = 'outofstock';
    } else if (parsedStock === undefined) {
      const raw = data['In stock?']?.trim();
      if (raw === '1') seoMeta.stockStatus = 'instock';
      else if (raw === '0') seoMeta.stockStatus = 'outofstock';
    }

    const isFeatured = data['Is featured?'] === '1';
    const isActive = data.Published !== '0' && data.Published !== '-1';

    const attrs = this.extractAttributes(data);
    const resolvedAttrs =
      attrs.length > 0
        ? await this.resolveAttributesCached(attrs, summary, attributeCache)
        : [];

    if (!isVariable && resolvedAttrs.length > 0) {
      seoMeta.attributes = resolvedAttrs.map((a) => ({
        name: a.name,
        values: a.values.map((v) => v.value),
      }));
    }

    const product = await this.prisma.product.create({
      data: {
        name,
        slug,
        sku,
        type: isVariable ? 'variable' : 'simple',
        description: data.Description?.trim() || null,
        shortDesc: data['Short description']?.trim() || null,
        basePrice,
        salePrice: salePrice ?? undefined,
        stock,
        categoryId: categoryId ?? undefined,
        brandId: brandId ?? undefined,
        tags: tags as any,
        productTags:
          tagIds.length > 0
            ? { create: tagIds.map((id) => ({ tagId: id })) }
            : undefined,
        images: [] as any,
        seoMeta: seoMeta as any,
        isFeatured,
        isActive,
        manageStock,
      },
    });

    productCache.set(sku, product.id);
    slugSet.add(product.slug);

    if (images.length > 0) {
      await this.processProductImagesCached(
        product.id,
        images,
        summary,
        errors,
        mediaCache,
      );
    }

    summary.productsCreated++;

    if (
      isVariable &&
      resolvedAttrs.length > 0 &&
      !options?.skipVariantGeneration
    ) {
      await this.generateVariantCombinationsCached(
        product.id,
        resolvedAttrs,
        product.sku || 'PRD',
        product.basePrice,
      );
    }

    return product.id;
  }

  private async updateProductCached(
    productId: string,
    row: CsvRowWithMeta,
    summary: ImportSummary,
    errors: ImportError[],
    categoryCacheByPath: Map<string, string>,
    tagCache: Map<string, string>,
    brandCache: Map<string, string>,
    mediaCache: Map<string, string>,
    productCache: Map<string, string>,
    slugSet: Set<string>,
  ): Promise<void> {
    const data = row.data;
    const categories = this.parseCategories(data.Categories);
    const tags = this.parseTags(data.Tags);
    const tagIds =
      tags.length > 0
        ? await this.resolveTagsCached(tags, summary, tagCache)
        : [];
    const images = this.parseImages(data.Images);

    const brandName = this.parseBrand(data.Brands);
    let brandId: string | null = null;
    if (brandName) {
      brandId = await this.resolveBrandCached(brandName, brandCache);
    }

    const categoryId = await this.resolveCategoriesCached(
      categories,
      summary,
      categoryCacheByPath,
    );
    const basePrice = this.parsePrice(data['Regular price']) ?? 0;
    const salePrice = this.parsePrice(data['Sale price']);
    const parsedStock = this.parseInt(data.Stock);
    const type = (data.Type || 'simple').toLowerCase().trim();
    const slug = data.Slug?.trim();
    const isVariable = type === 'variable' || type === 'variable-subscription';
    const manageStock =
      !isVariable && parsedStock !== undefined && parsedStock > 0;
    const stock = manageStock ? parsedStock : 0;
    const seoMeta = this.buildSeoMeta(data);

    // WooCommerce-compatible stock status
    if (parsedStock !== undefined && parsedStock <= 0) {
      seoMeta.stockStatus = 'outofstock';
    } else if (parsedStock === undefined) {
      const raw = data['In stock?']?.trim();
      if (raw === '1') seoMeta.stockStatus = 'instock';
      else if (raw === '0') seoMeta.stockStatus = 'outofstock';
    }

    const isFeatured = data['Is featured?'] === '1';
    const isActive = data.Published !== '0' && data.Published !== '-1';

    const updateData: Record<string, unknown> = {};

    if (data.Name?.trim()) updateData.name = data.Name.trim();
    if (data.Description?.trim() !== undefined)
      updateData.description = data.Description.trim() || null;
    if (data['Short description']?.trim() !== undefined)
      updateData.shortDesc = data['Short description'].trim() || null;
    updateData.basePrice = basePrice;
    updateData.salePrice = salePrice ?? null;
    updateData.stock = stock;
    updateData.categoryId = categoryId ?? null;
    updateData.brandId = brandId;
    updateData.tags = tags;
    updateData.productTags =
      tagIds.length > 0
        ? { deleteMany: {}, create: tagIds.map((id) => ({ tagId: id })) }
        : { deleteMany: {} };
    updateData.type = isVariable ? 'variable' : type;
    if (slug) {
      updateData.slug = slug;
      slugSet.add(slug);
    }
    updateData.seoMeta = seoMeta;
    updateData.isFeatured = isFeatured;
    updateData.isActive = isActive;
    updateData.manageStock = manageStock;

    await this.prisma.product.update({
      where: { id: productId },
      data: updateData,
    });

    if (images.length > 0) {
      await this.processProductImagesCached(
        productId,
        images,
        summary,
        errors,
        mediaCache,
      );
    }

    this.logger.log(`Product ${productId}: updated (type=${type})`);
    summary.productsUpdated++;
  }

  private async processVariationCached(
    productId: string,
    parentSku: string,
    row: CsvRowWithMeta,
    mode: 'create' | 'update',
    summary: ImportSummary,
    errors: ImportError[],
    attributeCache: Map<string, CachedAttribute>,
    mediaCache: Map<string, string>,
    variantCache: Map<string, string>,
  ): Promise<void> {
    const data = row.data;
    const varSku = data.SKU?.trim();
    if (!varSku) {
      this.logger.warn(`Variation row ${row.rowNumber}: skipped — no SKU.`);
      return;
    }

    const existingId = variantCache.get(varSku);

    if (existingId && mode === 'create') {
      summary.productsSkipped++;
      return;
    }

    const regPrice = this.parsePrice(data['Regular price']);
    const salePrice = this.parsePrice(data['Sale price']);
    const price = salePrice ?? regPrice;
    const stock = this.parseInt(data.Stock) ?? 0;
    const images = this.parseImages(data.Images);
    const mainImage = images[0];

    const varAttrs = this.extractVariationAttributes(data);
    const resolvedVarAttrs =
      varAttrs.length > 0
        ? await this.resolveAttributesCached(varAttrs, summary, attributeCache)
        : [];

    if (existingId) {
      const updateData: Record<string, unknown> = {};
      if (regPrice !== undefined) updateData.price = regPrice;
      if (salePrice !== undefined) updateData.salePrice = salePrice;
      updateData.stock = stock;
      if (mainImage) updateData.image = mainImage;

      await this.prisma.productVariant.update({
        where: { id: existingId },
        data: updateData,
      });

      if (mainImage) {
        const ingested = await this.ingestImageCached(
          mainImage,
          summary,
          errors,
          mediaCache,
        );
        if (ingested) {
          await this.media.syncEntityImages('variant', existingId, [ingested]);
        }
      }

      if (resolvedVarAttrs.length > 0) {
        await this.prisma.productVariantAttributeValue.deleteMany({
          where: { variantId: existingId },
        });
        await this.prisma.productVariantAttributeValue.createMany({
          data: resolvedVarAttrs.flatMap((attr) =>
            attr.values.map((av) => ({
              variantId: existingId,
              attributeValueId: av.id,
            })),
          ),
        });
      }

      summary.productsUpdated++;
      return;
    }

    const variant = await this.prisma.productVariant.create({
      data: {
        productId,
        sku: varSku,
        price: regPrice ?? undefined,
        salePrice: salePrice ?? undefined,
        stock,
        image: mainImage || undefined,
        attributeValues:
          resolvedVarAttrs.length > 0
            ? {
                create: resolvedVarAttrs.flatMap((attr) =>
                  attr.values.map((av) => ({
                    attributeValueId: av.id,
                  })),
                ),
              }
            : undefined,
      },
    });

    variantCache.set(varSku, variant.id);

    if (mainImage) {
      const ingested = await this.ingestImageCached(
        mainImage,
        summary,
        errors,
        mediaCache,
      );
      if (ingested) {
        await this.media.syncEntityImages('variant', variant.id, [ingested]);
      }
    }

    summary.variantsImported++;
  }

  private async processProductImagesCached(
    productId: string,
    urls: string[],
    summary: ImportSummary,
    errors: ImportError[],
    mediaCache: Map<string, string>,
  ): Promise<void> {
    const resolved: string[] = [];

    for (const url of urls) {
      const ingested = await this.ingestImageCached(
        url,
        summary,
        errors,
        mediaCache,
      );
      if (ingested) {
        resolved.push(ingested);
      }
    }

    if (resolved.length > 0) {
      const synced = await this.media.syncEntityImages(
        'product',
        productId,
        resolved,
      );
      await this.prisma.product.update({
        where: { id: productId },
        data: { images: synced as any },
      });
    }
  }

  private async ingestImageCached(
    url: string,
    summary: ImportSummary,
    errors: ImportError[],
    mediaCache: Map<string, string>,
  ): Promise<string | null> {
    const trimmed = url.trim();
    if (!trimmed) return null;

    const existing = mediaCache.get(trimmed);
    if (existing) {
      summary.imagesReused++;
      return existing;
    }

    try {
      const result = await this.media.ingestFromUrl(trimmed);
      summary.imagesImported++;
      mediaCache.set(trimmed, result.url);
      return result.url;
    } catch (err) {
      const msg = `Image failed: ${(err as Error).message}`;
      this.logger.warn(`${msg} — ${url}`);
      summary.imagesFailed++;
      errors.push({
        rowNumber: 0,
        sku: url,
        errorType: 'IMAGE_DOWNLOAD_FAILED',
        message: `${msg}: ${url}`,
      });
      return null;
    }
  }

  private parseCategories(value?: string): ParsedCategory[] {
    if (!value?.trim()) return [];
    return value
      .split(/[,|]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((part) => {
        const segments = part
          .split('>')
          .map((s) => s.trim())
          .filter(Boolean);
        const name = segments[segments.length - 1] || part;
        return { name, slug: slugify(name), path: part };
      });
  }

  private async resolveCategoriesCached(
    categories: ParsedCategory[],
    summary: ImportSummary,
    categoryCacheByPath: Map<string, string>,
  ): Promise<string | null> {
    if (categories.length === 0) return null;

    const first = categories[0];
    const segments = first.path
      .split('>')
      .map((s) => s.trim())
      .filter(Boolean);
    let parentId: string | null = null;
    let lastId: string | null = null;
    let currentPath = '';

    for (const seg of segments) {
      currentPath = currentPath ? `${currentPath} > ${seg}` : seg;
      const cachedId = categoryCacheByPath.get(currentPath);

      if (cachedId) {
        summary.categoriesReused++;
        lastId = cachedId;
        parentId = cachedId;
      } else {
        const slug = slugify(seg);
        const cat = await this.prisma.category.create({
          data: {
            name: seg,
            slug,
            parentId,
            sortOrder: 0,
            isActive: true,
          },
        });
        summary.categoriesCreated++;
        categoryCacheByPath.set(currentPath, cat.id);
        lastId = cat.id;
        parentId = cat.id;
      }
    }

    return lastId;
  }

  private async resolveTagsCached(
    tagNames: string[],
    summary: ImportSummary,
    tagCache: Map<string, string>,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const name of tagNames) {
      const slug = slugify(name);
      const cachedId = tagCache.get(slug);
      if (cachedId) {
        summary.tagsReused++;
        ids.push(cachedId);
      } else {
        const created = await this.prisma.tag.create({
          data: { name, slug, productCount: 1 },
        });
        summary.tagsCreated++;
        tagCache.set(slug, created.id);
        ids.push(created.id);
      }
    }
    return ids;
  }

  private async resolveBrandCached(
    brandName: string,
    brandCache: Map<string, string>,
  ): Promise<string> {
    const slug = slugify(brandName.trim());
    const cachedId = brandCache.get(slug);
    if (cachedId) return cachedId;

    const upserted = await this.prisma.brand.upsert({
      where: { slug },
      create: {
        name: brandName.trim(),
        slug,
        isActive: true,
      },
      update: {}, // already exists — keep as-is
    });
    brandCache.set(slug, upserted.id);
    return upserted.id;
  }

  private parseBrand(value?: string): string | null {
    if (!value?.trim()) return null;
    const names = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return names[0] || null;
  }

  private parseTags(value?: string): string[] {
    if (!value?.trim()) return [];
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private parseImages(value?: string): string[] {
    if (!value?.trim()) return [];
    return value
      .split(/[|,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private extractAttributes(data: WooCommerceCsvRow): Array<{
    name: string;
    values: string[];
    visible: boolean;
    global: boolean;
  }> {
    const attrs: Array<{
      name: string;
      values: string[];
      visible: boolean;
      global: boolean;
    }> = [];

    for (let i = 1; i <= 20; i++) {
      const nameKey = `Attribute ${i} name`;
      const valuesKey = `Attribute ${i} value(s)`;
      const visibleKey = `Attribute ${i} visible`;
      const globalKey = `Attribute ${i} global`;

      const name = data[nameKey]?.trim();
      if (!name) continue;

      const values = (data[valuesKey] || '')
        .split(/[,|]/)
        .map((v) => v.trim())
        .filter(Boolean);

      if (values.length === 0) continue;

      attrs.push({
        name,
        values,
        visible: data[visibleKey] === '1',
        global: data[globalKey] === '1' || data[globalKey] === undefined,
      });
    }

    return attrs;
  }

  private extractVariationAttributes(data: WooCommerceCsvRow): Array<{
    name: string;
    values: string[];
    visible: boolean;
    global: boolean;
  }> {
    const attrs: Array<{
      name: string;
      values: string[];
      visible: boolean;
      global: boolean;
    }> = [];

    for (let i = 1; i <= 5; i++) {
      const nameKey = `Attribute ${i} name`;
      const valuesKey = `Attribute ${i} value(s)`;
      const valuesKeyAlt = `Attribute ${i} value`;

      const name = data[nameKey]?.trim();
      const value = (data[valuesKey] || data[valuesKeyAlt])?.trim();

      if (!name || !value) continue;

      const parsed = value
        .split(/[,|]/)
        .map((v) => v.trim())
        .filter(Boolean);

      attrs.push({
        name,
        values: parsed,
        visible: true,
        global: true,
      });
    }

    return attrs;
  }

  private async resolveAttributesCached(
    attrs: Array<{
      name: string;
      values: string[];
      visible: boolean;
      global: boolean;
    }>,
    summary: ImportSummary,
    attributeCache: Map<string, CachedAttribute>,
  ): Promise<ResolvedAttrs[]> {
    const result: ResolvedAttrs[] = [];

    for (const attr of attrs) {
      const cleanName = attr.name.startsWith('pa_')
        ? attr.name.slice(3)
        : attr.name;
      const normalizedName = cleanName
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
      const normalizedKey = normalizedName.toLowerCase();

      let cachedAttr = attributeCache.get(normalizedKey);

      if (!cachedAttr) {
        const attribute = await this.prisma.attribute.create({
          data: { name: normalizedName },
          include: { values: true },
        });
        summary.attributesImported++;

        cachedAttr = {
          id: attribute.id,
          values: new Map(
            attribute.values.map((v) => [v.value.toLowerCase(), v.id]),
          ),
        };
        attributeCache.set(normalizedKey, cachedAttr);
      }

      const resolvedValues: Array<{ id: string; value: string }> = [];

      for (const rawVal of attr.values) {
        const v = rawVal.trim();
        if (!v) continue;
        const valueKey = v.toLowerCase();

        let valId = cachedAttr.values.get(valueKey);

        if (!valId) {
          const av = await this.prisma.attributeValue.create({
            data: {
              value: v,
              sortOrder: cachedAttr.values.size,
              attributeId: cachedAttr.id,
            },
          });
          valId = av.id;
          cachedAttr.values.set(valueKey, valId);
        }

        resolvedValues.push({ id: valId, value: v });
      }

      if (resolvedValues.length > 0) {
        result.push({ name: normalizedName, values: resolvedValues });
      }
    }

    return result;
  }

  private async generateVariantCombinationsCached(
    productId: string,
    resolvedAttrs: ResolvedAttrs[],
    productSku: string,
    productBasePrice: any,
  ): Promise<void> {
    const valuesArrays = resolvedAttrs.map((a) => a.values);
    const combinations = this.cartesian(valuesArrays);

    for (const combo of combinations) {
      const suffix = combo.map((v) => v.value).join(' / ');
      const varSku = `${productSku}-${suffix
        .replace(/\s+/g, '-')
        .replace(/\//g, '_')
        .toUpperCase()}`;

      await this.prisma.productVariant.create({
        data: {
          productId,
          sku: varSku,
          price: productBasePrice ?? undefined,
          stock: 0,
          attributeValues: {
            create: combo.map((v) => ({
              attributeValueId: v.id,
            })),
          },
        },
      });
    }

    if (combinations.length > 0) {
      await this.prisma.product.update({
        where: { id: productId },
        data: { type: 'variable' },
      });
    }
  }

  private uniqueSlugCached(base: string, slugSet: Set<string>): string {
    let slug = base;
    let counter = 1;
    while (slugSet.has(slug)) {
      slug = `${base}-${counter}`;
      counter++;
    }
    slugSet.add(slug);
    return slug;
  }

  private buildSeoMeta(data: WooCommerceCsvRow): Record<string, unknown> {
    const meta: Record<string, unknown> = {};

    const backorders = data['Backorders allowed?']?.trim();
    if (backorders) {
      if (backorders === '0') meta.backorders = 'no';
      else if (backorders === '1') meta.backorders = 'yes';
      else if (backorders === 'notify') meta.backorders = 'notify';
      else meta.backorders = backorders;
    }

    const weight = data['Weight (kg)']?.trim();
    if (weight) meta.weight = weight;

    const length = data['Length (cm)']?.trim();
    if (length) meta.length = length;

    const width = data['Width (cm)']?.trim();
    if (width) meta.width = width;

    const height = data['Height (cm)']?.trim();
    if (height) meta.height = height;

    const taxClass = data['Tax class']?.trim();
    if (taxClass) meta.taxClass = taxClass;

    const taxStatus = data['Tax status']?.trim();
    if (taxStatus) meta.taxStatus = taxStatus;

    const visibility = data['Visibility in catalog']?.trim();
    if (visibility) meta.visibility = visibility;

    const purchaseNote = data['Purchase note']?.trim();
    if (purchaseNote) meta.purchaseNote = purchaseNote;

    const salePriceStart = data['Date sale price starts']?.trim();
    if (salePriceStart) meta.salePriceStart = salePriceStart;

    const salePriceEnd = data['Date sale price ends']?.trim();
    if (salePriceEnd) meta.salePriceEnd = salePriceEnd;

    if (data.Categories?.trim()) {
      const parsed = this.parseCategories(data.Categories);
      meta.allCategories = parsed.map((c) => ({
        name: c.name,
        slug: c.slug,
        path: c.path,
      }));
    }

    return meta;
  }

  private parsePrice(val?: string): number | undefined {
    if (!val || val.trim() === '') return undefined;
    const cleaned = val.trim().replace(/[^0-9.-]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? undefined : n;
  }

  private parseInt(val?: string): number | undefined {
    if (!val || val.trim() === '') return undefined;
    const cleaned = val.trim().replace(/[^0-9-]/g, '');
    const n = parseInt(cleaned, 10);
    return isNaN(n) ? undefined : n;
  }

  private cartesian<T>(arrays: T[][]): T[][] {
    if (arrays.length === 0) return [];
    return arrays.reduce(
      (acc, curr) => acc.flatMap((a) => curr.map((b) => [...a, b])),
      [[]] as T[][],
    );
  }
}
