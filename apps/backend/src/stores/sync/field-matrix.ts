/**
 * §8.11 field-contract matrix — central-commerce P4.
 *
 * Table A: mapping + capability gate + override/baseline flags.
 * Table B behaviours are consumed by ProductSyncService (create / update /
 * conflict / unpublish / delete + audit level F/G).
 *
 * A field absent from this matrix cannot be synced: `assertSyncedFieldsSubset`
 * fails the build for any adapter declaring an unknown key.
 */
import { SeoMetaAccessor } from '../../products/seo-meta.accessor';

export type AuditLevel = 'F' | 'G';

export interface FieldMatrixRow {
  key: string;
  capability: string; // ProviderCapabilities key gating the field
  override: boolean; // external change preserved (BR-02/BR-03)
  baseline: boolean; // per-field hash baseline required
  audit: AuditLevel; // F = field-level, G = group-level
}

export const FIELD_MATRIX: FieldMatrixRow[] = [
  { key: 'name', capability: 'products', override: true, baseline: true, audit: 'F' },
  { key: 'shortDescription', capability: 'products', override: true, baseline: true, audit: 'F' },
  { key: 'fullDescription', capability: 'products', override: true, baseline: true, audit: 'F' },
  { key: 'sku', capability: 'products', override: true, baseline: true, audit: 'F' },
  { key: 'productCode', capability: 'products', override: true, baseline: true, audit: 'F' },
  { key: 'barcode', capability: 'products', override: true, baseline: true, audit: 'F' },
  { key: 'primaryImage', capability: 'media', override: true, baseline: true, audit: 'F' },
  { key: 'galleryImages', capability: 'media', override: true, baseline: true, audit: 'F' },
  { key: 'category', capability: 'categories', override: true, baseline: true, audit: 'F' },
  { key: 'brand', capability: 'products', override: true, baseline: true, audit: 'F' },
  { key: 'tags', capability: 'products', override: true, baseline: true, audit: 'F' },
  { key: 'productType', capability: 'products', override: false, baseline: true, audit: 'G' },
  { key: 'variants', capability: 'variations', override: true, baseline: true, audit: 'F' },
  { key: 'variantAttributes', capability: 'variations', override: true, baseline: true, audit: 'F' },
  { key: 'price', capability: 'products', override: true, baseline: true, audit: 'F' },
  { key: 'salePrice', capability: 'products', override: true, baseline: true, audit: 'F' },
  { key: 'costPrice', capability: 'costPrice', override: false, baseline: true, audit: 'F' },
  { key: 'weight', capability: 'weight', override: true, baseline: true, audit: 'F' },
  { key: 'dimensions', capability: 'dimensions', override: true, baseline: true, audit: 'F' },
  { key: 'seoTitle', capability: 'seo', override: true, baseline: true, audit: 'F' },
  { key: 'seoDescription', capability: 'seo', override: true, baseline: true, audit: 'F' },
  { key: 'slug', capability: 'slug', override: true, baseline: true, audit: 'F' },
  { key: 'publicationState', capability: 'products', override: false, baseline: true, audit: 'G' },
  { key: 'customFields', capability: 'products', override: true, baseline: true, audit: 'F' },
];

const MATRIX_KEYS = new Set(FIELD_MATRIX.map((r) => r.key));

/** Every adapter field list MUST be a subset of the matrix (build gate). */
export function assertSyncedFieldsSubset(slug: string, fields: string[]): void {
  const unknown = fields.filter((f) => !MATRIX_KEYS.has(f));
  if (unknown.length > 0) {
    throw new Error(`[${slug}] syncedFields not in §8.11 matrix: ${unknown.join(', ')}`);
  }
}

export function matrixRowFor(field: string): FieldMatrixRow | undefined {
  return FIELD_MATRIX.find((r) => r.key === field);
}

/** Custom-field allowlist: never secrets. */
const CUSTOM_FIELD_ALLOWLIST = new Set([
  'material',
  'care',
  'fit',
  'origin',
  'warranty',
  'purchaseNote',
  'visibility',
  'taxClass',
  'taxStatus',
]);

const SECRET_KEY_PATTERN = /secret|token|password|api[_-]?key|private/i;

export function isAllowedCustomField(key: string): boolean {
  if (SECRET_KEY_PATTERN.test(key)) return false;
  return CUSTOM_FIELD_ALLOWLIST.has(key);
}

/** Extract the canonical per-field values from a Product row (read-only). */
export function readEcoMateFields(product: any): Record<string, unknown> {
  const images: string[] = Array.isArray(product.images) ? product.images : [];
  const tags: unknown = product.productTags ?? product.tags ?? [];
  const seoBag = SeoMetaAccessor.bagOf(product.seoMeta);
  return {
    name: product.name,
    shortDescription: product.shortDesc ?? null,
    fullDescription: product.description ?? null,
    sku: product.sku ?? null,
    productCode: product.sku ?? null,
    barcode: product.sku ?? null,
    primaryImage: images[0] ?? null,
    galleryImages: images.slice(1),
    category: product.categoryId ?? null,
    brand: product.brandId ?? product.brand?.name ?? null,
    tags,
    productType: product.type,
    variants: (product.variants ?? []).map((v: any) => ({
      sku: v.sku,
      price: v.price !== undefined && v.price !== null ? String(v.price) : null,
      salePrice: v.salePrice !== undefined && v.salePrice !== null ? String(v.salePrice) : null,
      isActive: v.isActive,
    })),
    variantAttributes: (product.variants ?? []).map((v: any) => ({
      sku: v.sku,
      attrs: (v.attributeValues ?? []).map((av: any) => av.attributeValueId ?? av),
    })),
    price: product.basePrice !== undefined && product.basePrice !== null ? String(product.basePrice) : null,
    salePrice: product.salePrice !== undefined && product.salePrice !== null ? String(product.salePrice) : null,
    weight: (seoBag['weight'] as string | undefined) ?? null,
    dimensions: {
      length: (seoBag['length'] as string | undefined) ?? null,
      width: (seoBag['width'] as string | undefined) ?? null,
      height: (seoBag['height'] as string | undefined) ?? null,
    },
    seoTitle: SeoMetaAccessor.getSeoTitle(product.seoMeta) ?? null,
    seoDescription: SeoMetaAccessor.getSeoDescription(product.seoMeta) ?? null,
    slug: product.slug,
    publicationState: product.status === 'active' && product.isActive === true ? 'published' : 'draft',
    customFields: Object.fromEntries(
      Object.entries(seoBag).filter(([k]) => isAllowedCustomField(k)),
    ),
  };
}
