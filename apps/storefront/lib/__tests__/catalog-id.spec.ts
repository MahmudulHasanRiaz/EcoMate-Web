import { describe, it, expect } from 'vitest';
import { resolveCatalogId, keepComboCatalogId } from '../catalog-id';

describe('resolveCatalogId (AddToCart catalog-matching fix)', () => {
  it('uses product.sku when present (matches feed product id)', () => {
    expect(resolveCatalogId({ id: 'uuid-1', sku: 'SKU-100' })).toBe('SKU-100');
  });

  it('falls back to product.id when no sku (feed product id = sku || id)', () => {
    expect(resolveCatalogId({ id: 'uuid-1' })).toBe('uuid-1');
    expect(resolveCatalogId({ id: 'uuid-1', sku: null })).toBe('uuid-1');
  });

  it('prefers variant.sku when a variant is present (feed variant id)', () => {
    expect(
      resolveCatalogId({ id: 'uuid-1', sku: 'PRD-1' }, { id: 'var-1', sku: 'VAR-9' }),
    ).toBe('VAR-9');
  });

  it('uses product.sku-variant.id composite when variant has no sku (feed fallback)', () => {
    expect(
      resolveCatalogId({ id: 'uuid-1', sku: 'PRD-1' }, { id: 'var-1' }),
    ).toBe('PRD-1-var-1');
  });

  it('uses variant.id when neither product nor variant has sku', () => {
    expect(
      resolveCatalogId({ id: 'uuid-1' }, { id: 'var-1' }),
    ).toBe('var-1');
  });

  it('combos keep their internal id (no catalog representation in the feed)', () => {
    expect(keepComboCatalogId('combo-1')).toBe('combo-1');
  });
});