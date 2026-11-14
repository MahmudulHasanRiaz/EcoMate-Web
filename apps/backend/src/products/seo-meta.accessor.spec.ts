import { SeoMetaAccessor } from './seo-meta.accessor';

describe('SeoMetaAccessor (P0 key resolution)', () => {
  it('exposes the canonical key list incl. weight/dims/seo/stockStatus', () => {
    const keys = SeoMetaAccessor.keys();
    for (const k of [
      'weight',
      'length',
      'width',
      'height',
      'title',
      'description',
      'keywords',
      'stockStatus',
    ]) {
      expect(keys).toContain(k);
    }
  });

  it('reads weight and dimensions written by the WC CSV importer shape', () => {
    const bag = { weight: '1.5', length: '10', width: '20', height: '5' };
    expect(SeoMetaAccessor.getWeight(bag)).toBe('1.5');
    expect(SeoMetaAccessor.getDimensions(bag)).toEqual({
      length: '10',
      width: '20',
      height: '5',
    });
  });

  it('resolves SEO title/description with legacy seo_title fallback', () => {
    expect(SeoMetaAccessor.getSeoTitle({ title: 'New' })).toBe('New');
    expect(SeoMetaAccessor.getSeoTitle({ seo_title: 'Legacy' })).toBe(
      'Legacy',
    );
    expect(
      SeoMetaAccessor.getSeoDescription({ seo_description: 'Legacy d' }),
    ).toBe('Legacy d');
    expect(SeoMetaAccessor.getSeoTitle({})).toBeUndefined();
  });

  it('reads stockStatus only for the two canonical values', () => {
    expect(SeoMetaAccessor.getStockStatus({ stockStatus: 'instock' })).toBe(
      'instock',
    );
    expect(SeoMetaAccessor.getStockStatus({ stockStatus: 'bogus' })).toBeUndefined();
  });

  it('merge() is surgical: untouched keys survive, undefined deletes', () => {
    const current = { weight: '1', title: 'T', keywords: 'k' };
    const next = SeoMetaAccessor.merge(current, { weight: '2' });
    expect(next).toEqual({ weight: '2', title: 'T', keywords: 'k' });
    expect(current).toEqual({ weight: '1', title: 'T', keywords: 'k' });

    const deleted = SeoMetaAccessor.merge(current, { weight: undefined });
    expect(deleted).toEqual({ title: 'T', keywords: 'k' });
  });

  it('setWeight/setDimensions/setSeo never whole-object replace', () => {
    const current = { weight: '1', length: 'a', title: 'T', extra: 1 };
    expect(SeoMetaAccessor.setWeight(current, '9')).toEqual({
      weight: '9',
      length: 'a',
      title: 'T',
      extra: 1,
    });
    expect(SeoMetaAccessor.setDimensions(current, { length: 'b' })).toEqual({
      weight: '1',
      length: 'b',
      title: 'T',
      extra: 1,
    });
    // width/height deleted via undefined, other keys preserved
    const d = SeoMetaAccessor.setDimensions(current, { length: 'b' });
    expect(d.title).toBe('T');
    expect(SeoMetaAccessor.setSeo(current, { title: 'N' })).toMatchObject({
      title: 'N',
    });
  });

  it('bagOf() tolerates null/array/primitive without throwing', () => {
    expect(SeoMetaAccessor.bagOf(null)).toEqual({});
    expect(SeoMetaAccessor.bagOf([])).toEqual({});
    expect(SeoMetaAccessor.bagOf('x')).toEqual({});
    expect(SeoMetaAccessor.getWeight(null)).toBeUndefined();
  });
});
