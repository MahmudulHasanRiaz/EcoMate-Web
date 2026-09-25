/**
 * SeoMetaAccessor — P0 foundation for central-commerce §8.11 rows 18–21.
 *
 * `Product.seoMeta` / `Combo.seoMeta` is a schemaless JSON bag with keys
 * accumulated over time (WC CSV importer, product form, stock status).
 * Every sync field-contract row that touches seoMeta MUST go through this
 * accessor so key names resolve in exactly one place and updates are
 * always surgical merges (never whole-object replace).
 *
 * Canonical keys (evidence):
 * - weight/length/width/height — import.service.ts buildSeoMeta
 *   ('Weight (kg)', 'Length (cm)', 'Width (cm)', 'Height (cm)')
 * - title/description/keywords — admin product-form.tsx
 * - seo_title/seo_description — legacy read in product-detail.tsx
 * - stockStatus ('instock'|'outofstock') — import.service.ts
 * - attributes/backorders/taxClass/taxStatus/visibility/purchaseNote/
 *   salePriceStart/salePriceEnd/allCategories — buildSeoMeta extras
 */

export const SEO_META_KEYS = [
  'weight',
  'length',
  'width',
  'height',
  'title',
  'description',
  'keywords',
  'seo_title',
  'seo_description',
  'stockStatus',
  'attributes',
  'backorders',
  'taxClass',
  'taxStatus',
  'visibility',
  'purchaseNote',
  'salePriceStart',
  'salePriceEnd',
  'allCategories',
] as const;

export type SeoMetaKey = (typeof SEO_META_KEYS)[number];
export type SeoMetaBag = Record<string, unknown>;

export const SeoMetaAccessor = {
  keys(): readonly SeoMetaKey[] {
    return SEO_META_KEYS;
  },

  isKnownKey(key: string): key is SeoMetaKey {
    return (SEO_META_KEYS as readonly string[]).includes(key);
  },

  bagOf(raw: unknown): SeoMetaBag {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as SeoMetaBag;
  },

  getWeight(raw: unknown): string | undefined {
    const bag = this.bagOf(raw);
    const v = bag['weight'];
    return typeof v === 'string' && v !== '' ? v : undefined;
  },

  getDimensions(raw: unknown): {
    length?: string;
    width?: string;
    height?: string;
  } {
    const bag = this.bagOf(raw);
    const pick = (k: string): string | undefined =>
      typeof bag[k] === 'string' && (bag[k] as string) !== ''
        ? (bag[k] as string)
        : undefined;
    return { length: pick('length'), width: pick('width'), height: pick('height') };
  },

  /** SEO title with legacy fallback chain: title → seo_title. */
  getSeoTitle(raw: unknown): string | undefined {
    const bag = this.bagOf(raw);
    for (const k of ['title', 'seo_title']) {
      const v = bag[k];
      if (typeof v === 'string' && v.trim() !== '') return v;
    }
    return undefined;
  },

  /** SEO description with legacy fallback chain. */
  getSeoDescription(raw: unknown): string | undefined {
    const bag = this.bagOf(raw);
    for (const k of ['description', 'seo_description']) {
      const v = bag[k];
      if (typeof v === 'string' && v.trim() !== '') return v;
    }
    return undefined;
  },

  getStockStatus(raw: unknown): 'instock' | 'outofstock' | undefined {
    const bag = this.bagOf(raw);
    return bag['stockStatus'] === 'instock' ||
      bag['stockStatus'] === 'outofstock'
      ? bag['stockStatus']
      : undefined;
  },

  /**
   * Surgical merge: returns a NEW object with only `patch` keys applied.
   * Unknown keys are preserved untouched; `undefined` patch values delete.
   * Never mutates inputs, never replaces the whole object.
   */
  merge(
    current: unknown,
    patch: Partial<Record<SeoMetaKey, unknown>>,
  ): SeoMetaBag {
    const next: SeoMetaBag = { ...this.bagOf(current) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    return next;
  },

  setWeight(current: unknown, weight?: string): SeoMetaBag {
    return this.merge(current, { weight });
  },

  setDimensions(
    current: unknown,
    dims: { length?: string; width?: string; height?: string },
  ): SeoMetaBag {
    return this.merge(current, {
      length: dims.length,
      width: dims.width,
      height: dims.height,
    });
  },

  setSeo(
    current: unknown,
    seo: { title?: string; description?: string; keywords?: string },
  ): SeoMetaBag {
    return this.merge(current, {
      title: seo.title,
      description: seo.description,
      keywords: seo.keywords,
    });
  },
};
