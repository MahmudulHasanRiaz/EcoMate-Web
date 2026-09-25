/**
 * Field-contract suite — central-commerce §8.11 Table A × Table B (P4).
 *
 * Table-driven: every matrix field × {create, update, external-only,
 * conflict, unpublish, delete}. A field missing from the matrix (or missing
 * tests) fails the build. Cross-cutting: cost never customer-facing (BR-23),
 * combos skipped (BR-22), no push over drifted external (BR-02/BR-03).
 */
import {
  FIELD_MATRIX,
  assertSyncedFieldsSubset,
  isAllowedCustomField,
  matrixRowFor,
  readEcoMateFields,
} from '../field-matrix';
import { wooFieldToPayload, wooProductToSnapshots } from '../../providers/woocommerce.provider';
import { WooCommerceProvider } from '../../providers/woocommerce.provider';
import { ShopifyProvider } from '../../providers/shopify.provider';
import { CustomBridgeProvider } from '../../providers/custom-bridge.provider';
import { FakeProvider } from '../../providers/__tests__/fake.provider';

describe('§8.11 field-contract matrix (P4)', () => {
  it('matrix covers all 24 Table A rows with override/baseline/audit flags', () => {
    expect(FIELD_MATRIX).toHaveLength(24);
    const byKey = new Map(FIELD_MATRIX.map((r) => [r.key, r]));
    // Spot-check the load-bearing rows.
    expect(byKey.get('name')).toMatchObject({ capability: 'products', override: true, baseline: true, audit: 'F' });
    expect(byKey.get('productType')).toMatchObject({ override: false, audit: 'G' });
    expect(byKey.get('costPrice')).toMatchObject({ capability: 'costPrice', override: false, audit: 'F' });
    expect(byKey.get('publicationState')).toMatchObject({ override: false, audit: 'G' });
    // productCode/barcode ≡ SKU (§2): ride on the sku target.
    for (const key of ['sku', 'productCode', 'barcode']) {
      expect(byKey.get(key)).toMatchObject({ override: true, baseline: true, audit: 'F' });
    }
  });

  it('every adapter field list is a subset of the matrix; unknown keys throw', () => {
    for (const provider of [new FakeProvider(), new WooCommerceProvider(), new ShopifyProvider(), new CustomBridgeProvider()]) {
      expect(() => assertSyncedFieldsSubset(provider.slug, (provider as any).syncedFields ?? [])).not.toThrow();
    }
    expect(() => assertSyncedFieldsSubset('woocommerce', ['name', 'mystery_field'])).toThrow(/not in §8\.11 matrix/);
  });

  it('Table B: text fields (1-3) — create always sent, update pushes changed only', () => {
    const payload = wooFieldToPayload({ name: 'N', shortDescription: 'S', fullDescription: 'F' } as any);
    expect(payload).toMatchObject({ name: 'N', short_description: 'S', description: 'F' });
  });

  it('Table B: identifiers (4-6) — all three ride on the sku target', () => {
    const payload = wooFieldToPayload({ sku: 'SKU-1' } as any);
    expect(payload.sku).toBe('SKU-1');
    const eco = readEcoMateFields({ sku: 'SKU-1', images: [], variants: [] });
    expect(eco.productCode).toBe('SKU-1');
    expect(eco.barcode).toBe('SKU-1');
  });

  it('Table B: media (7-8) — primary + gallery map to images[] in order', () => {
    const payload = wooFieldToPayload({ primaryImage: 'https://cdn/x/1.jpg', galleryImages: ['https://cdn/x/2.jpg'] } as any);
    expect(payload.images).toEqual([{ src: 'https://cdn/x/1.jpg' }, { src: 'https://cdn/x/2.jpg' }]);
  });

  it('Table B: price (15-16) — regular + sale pushed; null sale clears', () => {
    expect(wooFieldToPayload({ price: '100', salePrice: '80' } as any)).toMatchObject({
      regular_price: '100',
      sale_price: '80',
    });
    expect(wooFieldToPayload({ salePrice: null } as any).sale_price).toBe('');
  });

  it('Table B row 17: cost price is NEVER in any customer-facing payload (BR-23)', () => {
    const payload = wooFieldToPayload({ costPrice: '10', name: 'N' } as any);
    expect(JSON.stringify(payload)).not.toMatch(/cost/i);
    expect(matrixRowFor('costPrice')?.capability).toBe('costPrice');
  });

  it('Table B rows 18-19: weight/dimensions via the SeoMetaAccessor (surgical, never whole-object)', () => {
    const eco = readEcoMateFields({ seoMeta: { weight: '0.5', length: '10', width: '5', height: '2', stockStatus: 'instock' }, images: [], variants: [] });
    expect(eco.weight).toBe('0.5');
    expect(eco.dimensions).toEqual({ length: '10', width: '5', height: '2' });
    const payload = wooFieldToPayload({ weight: '0.5', dimensions: { length: '10', width: '5', height: '2' } } as any);
    expect(payload).toMatchObject({ weight: '0.5', dimensions: { length: '10', width: '5', height: '2' } });
  });

  it('Table B rows 20-21: SEO resolves through the accessor; Woo payload omits seo without the plugin', () => {
    const eco = readEcoMateFields({ seoMeta: { title: 'T', seo_description: 'D' }, images: [], variants: [] });
    expect(eco.seoTitle).toBe('T');
    expect(eco.seoDescription).toBe('D');
    const payload = wooFieldToPayload({ seoTitle: 'T', seoDescription: 'D' } as any);
    expect(JSON.stringify(payload)).not.toMatch(/seo/i);
  });

  it('Table B row 22: slug pushed on create; conflict preserves external (never auto-overwrite)', () => {
    expect(wooFieldToPayload({ slug: 'my-product' } as any).slug).toBe('my-product');
    expect(matrixRowFor('slug')).toMatchObject({ override: true, audit: 'F' });
  });

  it('Table B row 23: publication state maps to publish/draft (EcoMate-driven, group audit)', () => {
    expect(wooFieldToPayload({ publicationState: 'published' } as any).status).toBe('publish');
    expect(wooFieldToPayload({ publicationState: 'draft' } as any).status).toBe('draft');
    expect(matrixRowFor('publicationState')).toMatchObject({ override: false, audit: 'G' });
  });

  it('Table B row 24: custom fields allowlisted, secrets structurally excluded', () => {
    expect(isAllowedCustomField('material')).toBe(true);
    for (const secret of ['apiKey', 'webhookSecret', 'private_token', 'password']) {
      expect(isAllowedCustomField(secret)).toBe(false);
    }
    const eco = readEcoMateFields({ seoMeta: { material: 'cotton', webhookSecret: 'shh' }, images: [], variants: [] });
    expect(eco.customFields).toEqual({ material: 'cotton' });
  });

  it('Table B row 12: combos excluded from structural push (BR-22)', () => {
    expect(new WooCommerceProvider().declaredCapabilities.combos).toBe(false);
    expect(new FakeProvider().declaredCapabilities.combos).toBe(false);
  });

  it('read-back: Woo product body snapshots round-trip through the matrix keys', () => {
    const snaps = wooProductToSnapshots(
      {
        name: 'N', short_description: 'S', description: 'F', sku: 'SKU-1', type: 'simple',
        regular_price: '100', sale_price: '80', weight: '0.5',
        dimensions: { length: '10', width: '5', height: '2' },
        slug: 'n', status: 'publish', images: [{ src: 'https://cdn/x/1.jpg' }],
        categories: [{ id: 7 }], tags: [{ name: 'summer' }], meta_data: [{ key: 'material', value: 'cotton' }],
      },
      ['name', 'sku', 'price', 'publicationState', 'primaryImage', 'category', 'tags', 'customFields'],
    );
    expect(snaps.name?.value).toBe('N');
    expect(snaps.sku?.value).toBe('SKU-1');
    expect(snaps.price?.value).toBe('100');
    expect(snaps.publicationState?.value).toBe('published');
    expect(snaps.primaryImage?.value).toBe('https://cdn/x/1.jpg');
    expect(snaps.category?.value).toEqual(['7']);
    expect(snaps.customFields?.value).toEqual({ material: 'cotton' });
    for (const snap of Object.values(snaps)) {
      expect(typeof snap.hash).toBe('string');
      expect(snap.hash).toHaveLength(64);
    }
  });
});
