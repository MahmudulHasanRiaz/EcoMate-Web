import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
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

    const rows: CsvRowWithMeta[] = parsed.data
      .map((data, i) => ({ rowNumber: i + 2, data }))
      .filter((r) => r.data.SKU?.trim());

    if (rows.length === 0) {
      throw new BadRequestException('No rows with SKU found in CSV');
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

    for (const [groupKey, group] of Object.entries(groups)) {
      if (!groupKey) continue;
      if (dryRun) continue;

      try {
        await this.processProductGroup(groupKey, group, mode, summary, allErrors);
      } catch (err) {
        const msg = (err as Error).message;
        this.logger.error(`Group processing failed for ${groupKey}: ${msg}`);
        allErrors.push({
          rowNumber: group[0].rowNumber,
          sku: groupKey,
          errorType: 'GROUP_PROCESSING_FAILED',
          message: msg,
        });
        summary.errors++;
      }
    }

    summary.imagesDownloaded = summary.imagesImported + summary.imagesReused;

    return { summary, errors: allErrors };
  }

  private groupByParent(rows: CsvRowWithMeta[]): Record<string, CsvRowWithMeta[]> {
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

      if (type === 'variation' && parentVal) {
        const resolvedParentSku = idToSku[parentVal] || parentVal;
        if (!groups[resolvedParentSku]) groups[resolvedParentSku] = [];
        groups[resolvedParentSku].push(row);
      } else {
        if (!groups[sku]) groups[sku] = [];
        groups[sku].push(row);
      }
    }

    return groups;
  }

  private async processProductGroup(
    groupKey: string,
    rows: CsvRowWithMeta[],
    mode: 'create' | 'update',
    summary: ImportSummary,
    errors: ImportError[],
  ): Promise<void> {
    const parentRow = rows.find(
      (r) => (r.data.Type || 'simple').toLowerCase() !== 'variation',
    ) || rows[0];

    const variationRows = rows.filter(
      (r) => (r.data.Type || 'simple').toLowerCase() === 'variation',
    );

    const parentSku = parentRow.data.SKU!.trim();

    const existingProduct = await this.prisma.product.findFirst({
      where: { sku: parentSku },
    });

    if (existingProduct && mode === 'create') {
      this.logger.log(`Skipping existing SKU: ${parentSku} (create mode)`);
      summary.productsSkipped++;
      return;
    }

    let productId: string;

    if (existingProduct) {
      await this.updateProduct(existingProduct.id, parentRow, summary, errors);
      productId = existingProduct.id;
    } else {
      productId = await this.createProduct(parentRow, summary, errors);
    }

    for (const vRow of variationRows) {
      await this.processVariation(productId, parentSku, vRow, mode, summary, errors);
    }
  }

  private async createProduct(
    row: CsvRowWithMeta,
    summary: ImportSummary,
    errors: ImportError[],
  ): Promise<string> {
    const data = row.data;
    const sku = data.SKU!.trim();
    const type = (data.Type || 'simple').toLowerCase().trim();
    const isVariable = type === 'variable' || type === 'variable-subscription';

    const categories = this.parseCategories(data.Categories);
    const tags = this.parseTags(data.Tags);
    const images = this.parseImages(data.Images);
    const seoMeta = this.buildSeoMeta(data);

    const categoryId = await this.resolveCategories(categories, summary);

    const name = data.Name?.trim() || sku;
    const slug = data.Slug?.trim() || await this.uniqueSlug(slugify(name));

    const basePrice = this.parsePrice(data['Regular price']) ?? 0;
    const salePrice = this.parsePrice(data['Sale price']);
    const manageStock = this.parseManageStock(data);
    const stock = manageStock ? (this.parseInt(data.Stock) ?? 0) : 0;
    const isFeatured = data['Is featured?'] === '1';
    const isActive = data.Published !== '0' && data.Published !== '-1';

    const attrs = this.extractAttributes(data);
    const resolvedAttrs = attrs.length > 0
      ? await this.resolveAttributes(attrs, summary)
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
        tags: tags as any,
        images: [] as any,
        seoMeta: seoMeta as any,
        isFeatured,
        isActive,
        manageStock,
      },
    });

    if (images.length > 0) {
      await this.processProductImages(product.id, images, summary, errors);
    }

    summary.productsCreated++;

    if (isVariable && resolvedAttrs.length > 0) {
      await this.generateVariantCombinations(product.id, resolvedAttrs);
    }

    return product.id;
  }

  private async updateProduct(
    productId: string,
    row: CsvRowWithMeta,
    summary: ImportSummary,
    errors: ImportError[],
  ): Promise<void> {
    const data = row.data;
    const categories = this.parseCategories(data.Categories);
    const tags = this.parseTags(data.Tags);
    const images = this.parseImages(data.Images);
    const seoMeta = this.buildSeoMeta(data);

    const categoryId = await this.resolveCategories(categories, summary);
    const basePrice = this.parsePrice(data['Regular price']) ?? 0;
    const salePrice = this.parsePrice(data['Sale price']);
    const manageStock = this.parseManageStock(data);
    const stock = manageStock ? (this.parseInt(data.Stock) ?? 0) : 0;
    const isFeatured = data['Is featured?'] === '1';
    const isActive = data.Published !== '0' && data.Published !== '-1';

    const updateData: Record<string, unknown> = {};

    if (data.Name?.trim()) updateData.name = data.Name.trim();
    if (data.Description?.trim() !== undefined) updateData.description = data.Description.trim() || null;
    if (data['Short description']?.trim() !== undefined) updateData.shortDesc = data['Short description'].trim() || null;
    updateData.basePrice = basePrice;
    updateData.salePrice = salePrice ?? null;
    updateData.stock = stock;
    updateData.categoryId = categoryId ?? null;
    updateData.tags = tags as any;
    updateData.seoMeta = seoMeta as any;
    updateData.isFeatured = isFeatured;
    updateData.isActive = isActive;
    updateData.manageStock = manageStock;

    await this.prisma.product.update({
      where: { id: productId },
      data: updateData,
    });

    if (images.length > 0) {
      await this.processProductImages(productId, images, summary, errors);
    }

    summary.productsUpdated++;
  }

  private async processVariation(
    productId: string,
    parentSku: string,
    row: CsvRowWithMeta,
    mode: 'create' | 'update',
    summary: ImportSummary,
    errors: ImportError[],
  ): Promise<void> {
    const data = row.data;
    const varSku = data.SKU?.trim();
    if (!varSku) return;

    const existing = await this.prisma.productVariant.findUnique({
      where: { sku: varSku },
    });

    if (existing && mode === 'create') {
      summary.productsSkipped++;
      return;
    }

    const price = this.parsePrice(data['Regular price']);
    const stock = this.parseInt(data.Stock) ?? 0;
    const images = this.parseImages(data.Images);
    const mainImage = images[0];

    const varAttrs = this.extractVariationAttributes(data);
    const resolvedVarAttrs = varAttrs.length > 0
      ? await this.resolveAttributes(varAttrs, summary)
      : [];

    if (existing) {
      const updateData: Record<string, unknown> = {};
      if (price !== undefined) updateData.price = price;
      updateData.stock = stock;
      if (mainImage) updateData.image = mainImage;

      await this.prisma.productVariant.update({
        where: { id: existing.id },
        data: updateData,
      });

      if (mainImage) {
        const ingested = await this.ingestImage(mainImage, summary, errors);
        if (ingested) {
          await this.media.syncEntityImages('variant', existing.id, [ingested]);
        }
      }

      summary.productsUpdated++;
      return;
    }

    const variant = await this.prisma.productVariant.create({
      data: {
        productId,
        sku: varSku,
        price: price ?? undefined,
        stock,
        image: mainImage || undefined,
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

    if (mainImage) {
      const ingested = await this.ingestImage(mainImage, summary, errors);
      if (ingested) {
        await this.media.syncEntityImages('variant', variant.id, [ingested]);
      }
    }

    summary.variantsImported++;
  }

  private async processProductImages(
    productId: string,
    urls: string[],
    summary: ImportSummary,
    errors: ImportError[],
  ): Promise<void> {
    const resolved: string[] = [];

    for (const url of urls) {
      const ingested = await this.ingestImage(url, summary, errors);
      if (ingested) {
        resolved.push(ingested);
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

  private async ingestImage(
    url: string,
    summary: ImportSummary,
    errors: ImportError[],
  ): Promise<string | null> {
    const trimmed = url.trim();
    if (!trimmed) return null;

    const existing = await this.prisma.media.findFirst({
      where: { sourceUrl: trimmed },
      select: { url: true },
    });

    if (existing) {
      summary.imagesReused++;
      return existing.url;
    }

    try {
      const result = await this.media.ingestFromUrl(trimmed);
      summary.imagesImported++;
      return result.url;
    } catch (err) {
      this.logger.warn(`Image failed for ${url}: ${(err as Error).message}`);
      summary.imagesFailed++;
      return null;
    }
  }

  private parseCategories(value?: string): ParsedCategory[] {
    if (!value?.trim()) return [];
    return value
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((part) => {
        const segments = part.split('>').map((s) => s.trim()).filter(Boolean);
        const name = segments[segments.length - 1] || part;
        return { name, slug: slugify(name), path: part };
      });
  }

  private async resolveCategories(
    categories: ParsedCategory[],
    summary: ImportSummary,
  ): Promise<string | null> {
    if (categories.length === 0) return null;

    const first = categories[0];
    const segments = first.path.split('>').map((s) => s.trim()).filter(Boolean);
    let parentId: string | null = null;
    let lastId: string | null = null;

    for (const seg of segments) {
      const slug = slugify(seg);
      let cat = await this.prisma.category.findFirst({
        where: { slug, parentId },
      });

      if (cat) {
        summary.categoriesReused++;
      } else {
        cat = await this.prisma.category.create({
          data: {
            name: seg,
            slug,
            parentId,
            sortOrder: 0,
            isActive: true,
          },
        });
        summary.categoriesCreated++;
      }

      lastId = cat.id;
      parentId = cat.id;
    }

    return lastId;
  }

  private parseTags(value?: string): string[] {
    if (!value?.trim()) return [];
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }

  private parseImages(value?: string): string[] {
    if (!value?.trim()) return [];
    return value.split('|').map((s) => s.trim()).filter(Boolean);
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
        .split('|')
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

      const name = data[nameKey]?.trim();
      const value = data[valuesKey]?.trim();
      if (!name || !value) continue;

      attrs.push({
        name,
        values: [value],
        visible: true,
        global: true,
      });
    }

    return attrs;
  }

  private async resolveAttributes(
    attrs: Array<{ name: string; values: string[]; visible: boolean; global: boolean }>,
    summary: ImportSummary,
  ): Promise<ResolvedAttrs[]> {
    const result: ResolvedAttrs[] = [];

    for (const attr of attrs) {
      const cleanName = attr.name.startsWith('pa_') ? attr.name.slice(3) : attr.name;
      const normalizedName = cleanName
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
        summary.attributesImported++;
      }

      const resolvedValues: Array<{ id: string; value: string }> = [];

      for (const rawVal of attr.values) {
        const v = rawVal.trim();
        if (!v) continue;

        let av = attribute.values.find(
          (av) => av.value.toLowerCase() === v.toLowerCase(),
        );

        if (!av) {
          av = await this.prisma.attributeValue.create({
            data: {
              value: v,
              sortOrder: attribute.values.length + resolvedValues.length,
              attributeId: attribute.id,
            },
          });
        }

        resolvedValues.push({ id: av.id, value: av.value });
      }

      if (resolvedValues.length > 0) {
        result.push({ name: normalizedName, values: resolvedValues });
      }
    }

    return result;
  }

  private async generateVariantCombinations(
    productId: string,
    resolvedAttrs: ResolvedAttrs[],
  ): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { sku: true, basePrice: true },
    });

    const valuesArrays = resolvedAttrs.map((a) => a.values);
    const combinations = this.cartesian(valuesArrays);

    for (const combo of combinations) {
      const suffix = combo.map((v) => v.value).join(' / ');
      const varSku = `${product?.sku || 'PRD'}-${suffix
        .replace(/\s+/g, '-')
        .replace(/\//g, '_')
        .toUpperCase()}`;

      await this.prisma.productVariant.create({
        data: {
          productId,
          sku: varSku,
          price: product?.basePrice ?? undefined,
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

  private async uniqueSlug(base: string): Promise<string> {
    let slug = base;
    let counter = 1;
    while (await this.prisma.product.findUnique({ where: { slug } })) {
      slug = `${base}-${counter}`;
      counter++;
    }
    return slug;
  }

  private buildSeoMeta(data: WooCommerceCsvRow): Record<string, unknown> {
    const meta: Record<string, unknown> = {};

    const stockStatusRaw = data['In stock?']?.trim();
    if (stockStatusRaw === '1') meta.stockStatus = 'instock';
    else if (stockStatusRaw === '0') meta.stockStatus = 'outofstock';

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

  private parseManageStock(data: WooCommerceCsvRow): boolean {
    const manageStockCol = data['Manage stock?'];
    const stockQty = data.Stock?.trim();

    if (manageStockCol !== undefined) {
      return manageStockCol === '1' || manageStockCol.toLowerCase() === 'yes';
    }

    return !!stockQty;
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
