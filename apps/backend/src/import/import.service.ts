import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import * as Papa from 'papaparse';
import slugify from '../import/utils/slugify';
import {
  WooCommerceCsvRow,
  ParsedCategory,
  ImportError,
  ImportSummary,
} from './types/woocommerce-csv.types';

interface ProcessedRow {
  rowNumber: number;
  data: WooCommerceCsvRow;
  errors: ImportError[];
}

interface ImportProgress {
  total: number;
  processed: number;
  summary: ImportSummary;
  errors: ImportError[];
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
    opts: { mode?: 'create' | 'update'; dryRun?: boolean } = {},
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

    if (parsed.errors.length > 0) {
      const msg = parsed.errors[0].message;
      throw new BadRequestException(`CSV parse error: ${msg}`);
    }

    const rows = parsed.data.filter((r) => r.SKU?.trim());
    if (rows.length === 0) {
      throw new BadRequestException('No rows with SKU found in CSV');
    }

    const progress: ImportProgress = {
      total: rows.length,
      processed: 0,
      summary: {
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
      },
      errors: [],
    };

    const groups = this.groupByParent(rows);

    for (const [parentSku, group] of Object.entries(groups)) {
      if (dryRun) {
        progress.processed += group.length;
        continue;
      }

      try {
        await this.processProductGroup(parentSku, group, mode, progress);
      } catch (err) {
        const msg = (err as Error).message;
        this.logger.error(`Failed processing group SKU=${parentSku}: ${msg}`);
        progress.errors.push({
          rowNumber: group[0].rowNumber,
          sku: parentSku,
          errorType: 'GROUP_PROCESSING_FAILED',
          message: msg,
        });
        progress.summary.errors++;
      }
    }

    progress.summary.imagesDownloaded = progress.summary.imagesImported + progress.summary.imagesReused;

    return {
      summary: progress.summary,
      errors: progress.errors,
    };
  }

  private groupByParent(
    rows: ProcessedRow[],
  ): Record<string, ProcessedRow[]> {
    const groups: Record<string, ProcessedRow[]> = {};

    for (const row of rows) {
      const sku = row.data.SKU?.trim() || '';
      const type = (row.data.Type || 'simple').toLowerCase().trim();
      const parentSku = row.data.Parent?.trim() || '';

      if (!sku) continue;

      if (type === 'variation' && parentSku) {
        if (!groups[parentSku]) groups[parentSku] = [];
        groups[parentSku].push(row);
      } else {
        if (!groups[sku]) groups[sku] = [];
        groups[sku].push(row);
      }
    }

    return groups;
  }

  private async processProductGroup(
    sku: string,
    rows: ProcessedRow[],
    mode: 'create' | 'update',
    progress: ImportProgress,
  ): Promise<void> {
    const parentRow = rows.find(
      (r) => (r.data.Type || 'simple').toLowerCase() !== 'variation',
    ) || rows[0];
    const variationRows = rows.filter(
      (r) => (r.data.Type || 'simple').toLowerCase() === 'variation',
    );

    const existingProduct = await this.prisma.product.findFirst({
      where: { sku },
      include: { variants: true },
    });

    if (existingProduct && mode === 'create') {
      this.logger.log(`Skipping existing SKU: ${sku} (create mode)`);
      progress.summary.productsSkipped++;
      return;
    }

    if (existingProduct) {
      await this.updateProduct(existingProduct.id, parentRow, mode, progress);
    } else {
      await this.createProduct(parentRow, progress);
    }

    if (variationRows.length > 0) {
      const product = await this.prisma.product.findFirst({
        where: { sku },
      });
      if (product) {
        for (const vRow of variationRows) {
          await this.processVariation(product.id, vRow, mode, progress);
        }
      }
    }
  }

  private async createProduct(
    row: ProcessedRow,
    progress: ImportProgress,
  ): Promise<string> {
    const data = row.data;
    const type = (data.Type || 'simple').toLowerCase().trim();
    const isVariable = type === 'variable' || type === 'variable-subscription';

    const categories = this.parseCategories(data.Categories);
    const tags = this.parseTags(data.Tags);
    const images = this.parseImages(data.Images);
    const seoMeta = this.buildSeoMeta(data);

    const categoryId = await this.resolveCategories(
      categories,
      progress,
    );

    const resolvedTags = await this.resolveTags(tags, progress);

    const slug = data.Slug?.trim() || slugify(data.Name || sku);

    const basePrice = this.parseFloat(data['Regular price']) || 0;
    const salePrice = this.parseFloat(data['Sale price']);

    const manageStock = this.parseBool(data['In stock?'], data.Stock);
    const stock = manageStock ? this.parseInt(data.Stock) || 0 : 0;
    const isFeatured = data['Is featured?'] === '1';

    const attrs = this.extractAttributes(data);
    const resolvedAttrs = await this.resolveAttributes(attrs, progress);

    const product = await this.prisma.product.create({
      data: {
        name: data.Name?.trim() || sku,
        slug,
        sku,
        type: isVariable ? 'variable' : 'simple',
        description: data.Description?.trim() || undefined,
        shortDesc: data['Short description']?.trim() || undefined,
        basePrice,
        salePrice: salePrice || undefined,
        stock,
        categoryId: categoryId || undefined,
        tags: resolvedTags as any,
        images: [] as any,
        seoMeta: seoMeta as any,
        isFeatured,
        isActive: data.Published !== '0' && data.Published !== '-1',
        manageStock,
      },
    });

    if (images.length > 0) {
      await this.processProductImages(product.id, images, progress);
    }

    progress.summary.productsCreated++;

    if (categoryId && categories.length > 0) {
      const usedCount = categories.length -
        (categories[0] ? (await this.categoryExists(categories[0].slug) ? 1 : 0) : 0);
    }

    if (isVariable && resolvedAttrs.length > 0) {
      await this.attachAttributesToProduct(product.id, resolvedAttrs);
    }

    return product.id;
  }

  private async updateProduct(
    productId: string,
    row: ProcessedRow,
    mode: 'create' | 'update',
    progress: ImportProgress,
  ): Promise<void> {
    const data = row.data;
    const categories = this.parseCategories(data.Categories);
    const tags = this.parseTags(data.Tags);
    const images = this.parseImages(data.Images);
    const seoMeta = this.buildSeoMeta(data);

    const categoryId = await this.resolveCategories(categories, progress);
    const resolvedTags = await this.resolveTags(tags, progress);
    const basePrice = this.parseFloat(data['Regular price']) || 0;
    const salePrice = this.parseFloat(data['Sale price']);
    const manageStock = this.parseBool(data['In stock?'], data.Stock);
    const stock = manageStock ? this.parseInt(data.Stock) || 0 : 0;
    const isFeatured = data['Is featured?'] === '1';

    await this.prisma.product.update({
      where: { id: productId },
      data: {
        name: data.Name?.trim(),
        description: data.Description?.trim() || undefined,
        shortDesc: data['Short description']?.trim() || undefined,
        basePrice,
        salePrice: salePrice || undefined,
        stock,
        categoryId: categoryId || undefined,
        tags: resolvedTags as any,
        seoMeta: seoMeta as any,
        isFeatured,
        isActive: data.Published !== '0' && data.Published !== '-1',
        manageStock,
      },
    });

    if (images.length > 0) {
      await this.processProductImages(productId, images, progress);
    }

    progress.summary.productsUpdated++;
  }

  private async processVariation(
    productId: string,
    row: ProcessedRow,
    mode: 'create' | 'update',
    progress: ImportProgress,
  ): Promise<void> {
    const data = row.data;
    const varSku = data.SKU?.trim();
    if (!varSku) return;

    const existing = await this.prisma.productVariant.findUnique({
      where: { sku: varSku },
    });

    if (existing && mode === 'create') {
      progress.summary.productsSkipped++;
      return;
    }

    const price = this.parseFloat(data['Regular price']);
    const stock = this.parseInt(data.Stock) || 0;
    const image = this.parseImages(data.Images)[0] || undefined;

    const varAttrs = this.extractVariationAttributes(data);
    const resolvedVarAttrs = await this.resolveAttributes(varAttrs, progress);

    if (existing) {
      await this.prisma.productVariant.update({
        where: { id: existing.id },
        data: {
          price: price || undefined,
          stock,
          image: image || undefined,
        },
      });

      if (image) {
        await this.media.syncEntityImages('variant', existing.id, [image]);
      }

      progress.summary.productsUpdated++;
      return;
    }

    const variant = await this.prisma.productVariant.create({
      data: {
        productId,
        sku: varSku,
        price: price || undefined,
        stock,
        image: image || undefined,
        attributeValues: resolvedVarAttrs.length > 0
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

    if (image) {
      await this.media.syncEntityImages('variant', variant.id, [image]);
    }

    progress.summary.variantsImported++;
  }

  private async processProductImages(
    productId: string,
    urls: string[],
    progress: ImportProgress,
  ): Promise<void> {
    const resolved: string[] = [];
    for (const url of urls) {
      try {
        const result = await this.media.ingestFromUrl(url.trim());
        resolved.push(result.url);
        progress.summary.imagesImported++;
      } catch (err) {
        this.logger.warn(`Image import failed for ${url}: ${(err as Error).message}`);
        progress.summary.imagesFailed++;
        progress.errors.push({
          rowNumber: 0,
          sku: '',
          errorType: 'IMAGE_DOWNLOAD_FAILED',
          message: `${url}: ${(err as Error).message}`,
        });
        progress.summary.errors++;
      }
    }

    if (resolved.length > 0) {
      const synced = await this.media.syncEntityImages('product', productId, resolved);
      await this.prisma.product.update({
        where: { id: productId },
        data: { images: synced as any },
      });
    }
  }

  private parseCategories(value?: string): ParsedCategory[] {
    if (!value?.trim()) return [];
    const parts = value.split('|').map((s) => s.trim()).filter(Boolean);
    return parts.map((part) => {
      const segments = part.split('>').map((s) => s.trim()).filter(Boolean);
      const name = segments[segments.length - 1];
      return {
        name,
        slug: slugify(name),
        path: part,
      };
    });
  }

  private async resolveCategories(
    categories: ParsedCategory[],
    progress: ImportSummary,
  ): Promise<string | null> {
    if (categories.length === 0) return null;

    const first = categories[0];
    const segments = first.path.split('>').map((s) => s.trim()).filter(Boolean);

    let parentId: string | null = null;
    let lastCategoryId: string | null = null;

    for (const seg of segments) {
      const slug = slugify(seg);

      let cat = await this.prisma.category.findFirst({
        where: { slug, parentId: parentId },
      });

      if (!cat) {
        cat = await this.prisma.category.create({
          data: {
            name: seg,
            slug,
            parentId,
            sortOrder: 0,
            isActive: true,
          },
        });
        progress.categoriesCreated++;
      }

      lastCategoryId = cat.id;
      parentId = cat.id;
    }

    return lastCategoryId;
  }

  private async categoryExists(slug: string): Promise<boolean> {
    const cat = await this.prisma.category.findFirst({ where: { slug } });
    return !!cat;
  }

  private parseTags(value?: string): string[] {
    if (!value?.trim()) return [];
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private async resolveTags(
    tags: string[],
    progress: ImportSummary,
  ): Promise<string[]> {
    return tags;
  }

  private parseImages(value?: string): string[] {
    if (!value?.trim()) return [];
    return value
      .split('|')
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

    for (let i = 1; i <= 10; i++) {
      const nameKey = `Attribute ${i} name`;
      const valuesKey = `Attribute ${i} value(s)`;
      const visibleKey = `Attribute ${i} visible`;
      const globalKey = `Attribute ${i} global`;

      const name = data[nameKey]?.trim();
      const valuesStr = data[valuesKey]?.trim();
      if (!name || !valuesStr) continue;

      const values = valuesStr.split('|').map((v) => v.trim()).filter(Boolean);
      if (values.length === 0) continue;

      attrs.push({
        name,
        values,
        visible: data[visibleKey] === '1',
        global: data[globalKey] === '1' || !data[globalKey],
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

    for (let i = 1; i <= 10; i++) {
      const nameKey = `Attribute ${i} name`;
      const valuesKey = `Attribute ${i} value(s)`;
      const visibleKey = `Attribute ${i} visible`;

      const name = data[nameKey]?.trim();
      const valuesStr = data[valuesKey]?.trim();
      if (!name || !valuesStr) continue;
      const values = valuesStr.split('|').map((v) => v.trim()).filter(Boolean);
      if (values.length === 0) continue;

      attrs.push({
        name,
        values,
        visible: data[visibleKey] === '1',
        global: true,
      });
    }

    return attrs;
  }

  private async resolveAttributes(
    attrs: Array<{
      name: string;
      values: string[];
      visible: boolean;
      global: boolean;
    }>,
    progress: ImportSummary,
  ): Promise<
    Array<{
      name: string;
      values: Array<{ id: string; value: string }>;
    }>
  > {
    const result: Array<{
      name: string;
      values: Array<{ id: string; value: string }>;
    }> = [];

    for (const attr of attrs) {
      const attrName =
        attr.name.startsWith('pa_') ? attr.name.slice(3) : attr.name;
      const normalizedName = attrName
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();

      let attribute = await this.prisma.attribute.findUnique({
        where: { name: normalizedName },
        include: { values: true },
      });

      if (!attribute) {
        attribute = await this.prisma.attribute.create({
          data: { name: normalizedName },
          include: { values: true },
        });
        progress.attributesImported++;
      }

      const resolvedValues: Array<{ id: string; value: string }> = [];
      for (const v of attr.values) {
        const normalizedValue = v.trim();
        let av = attribute.values.find(
          (av) => av.value.toLowerCase() === normalizedValue.toLowerCase(),
        );
        if (!av) {
          av = await this.prisma.attributeValue.create({
            data: {
              value: normalizedValue,
              sortOrder: attribute.values.length + resolvedValues.length,
              attributeId: attribute.id,
            },
          });
        }
        resolvedValues.push({ id: av.id, value: av.value });
      }

      result.push({
        name: normalizedName,
        values: resolvedValues,
      });
    }

    return result;
  }

  private async attachAttributesToProduct(
    productId: string,
    attrs: Array<{
      name: string;
      values: Array<{ id: string; value: string }>;
    }>,
  ): Promise<void> {
    const existingVariants = await this.prisma.productVariant.findMany({
      where: { productId },
    });

    if (existingVariants.length === 0) {
      const attributeIds = attrs.map((a) => {
        return a.values.map((v) => v.id).filter((id, i, arr) => arr.indexOf(id) === i);
      }).flat();

      if (attributeIds.length > 0) {
        const product = await this.prisma.product.findUnique({
          where: { id: productId },
          select: { sku: true, basePrice: true },
        });

        const combinations = this.cartesian(attrs.map((a) => a.values));
        for (const combo of combinations) {
          const valuesStr = combo.map((v) => v.value).join(' / ');
          const varSku = `${product?.sku || 'PRD'}-${valuesStr.replace(/\s+/g, '-').replace(/\//g, '_').toUpperCase()}`;

          await this.prisma.productVariant.create({
            data: {
              productId,
              sku: varSku,
              price: product?.basePrice || undefined,
              stock: 0,
              attributeValues: {
                create: combo.map((v) => ({
                  attributeValueId: v.id,
                })),
              },
            },
          });
        }
      }
    }

    if (existingVariants.length > 0 || attrs.some((a) => a.values.length > 0)) {
      await this.prisma.product.update({
        where: { id: productId },
        data: { type: 'variable' },
      });
    }
  }

  private cartesian<T>(arrays: T[][]): T[][] {
    if (arrays.length === 0) return [];
    return arrays.reduce(
      (acc, curr) => acc.flatMap((a) => curr.map((b) => [...a, b])),
      [[]] as T[][],
    );
  }

  private buildSeoMeta(data: WooCommerceCsvRow): Record<string, unknown> {
    const meta: Record<string, unknown> = {};

    const inStock = data['In stock?']?.trim();
    if (inStock === '1') meta.stockStatus = 'instock';
    else if (inStock === '0') meta.stockStatus = 'outofstock';

    const backorders = data['Backorders allowed?']?.trim();
    if (backorders !== undefined && backorders !== '') {
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

    const categories = data.Categories?.trim();
    if (categories) {
      const parsed = this.parseCategories(categories);
      meta.allCategories = parsed.map((c) => ({
        name: c.name,
        slug: c.slug,
        path: c.path,
      }));
    }

    const purchaseNote = data['Purchase note']?.trim();
    if (purchaseNote) meta.purchaseNote = purchaseNote;

    const salePriceStart = data['Date sale price starts']?.trim();
    if (salePriceStart) meta.salePriceStart = salePriceStart;

    const salePriceEnd = data['Date sale price ends']?.trim();
    if (salePriceEnd) meta.salePriceEnd = salePriceEnd;

    return meta;
  }

  private parseFloat(val?: string): number | undefined {
    if (val === undefined || val === null || val.trim() === '') return undefined;
    const cleaned = val.trim().replace(/[^0-9.-]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? undefined : n;
  }

  private parseInt(val?: string): number | undefined {
    if (val === undefined || val === null || val.trim() === '') return undefined;
    const cleaned = val.trim().replace(/[^0-9-]/g, '');
    const n = parseInt(cleaned, 10);
    return isNaN(n) ? undefined : n;
  }

  private parseBool(inStock?: string, stockQty?: string): boolean {
    if (stockQty !== undefined && stockQty.trim() !== '') {
      return true;
    }
    if (inStock !== undefined && inStock.trim() !== '') {
      return true;
    }
    return false;
  }
}
