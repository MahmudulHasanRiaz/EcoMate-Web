import { mergeContext } from '../context-merge';

describe('mergeContext (design §4.1 enrichment rules)', () => {
  it('starts empty', () => {
    const r = mergeContext(null, {});
    expect(r.identifiers).toEqual({});
  });

  it('stores incoming cookie identifiers with provenance', () => {
    const r = mergeContext(null, {
      identifiers: { meta: { fbp: 'fbp' } },
    });
    expect(r.identifiers.meta.fbp.value).toBe('fbp');
    expect(r.identifiers.meta.fbp.firstSeenAt).toBeDefined();
  });

  it('rotating cookie id: replace when a newer value arrives, never clear', () => {
    const r1 = mergeContext(null, { identifiers: { meta: { fbp: 'fbp.1.111.1' } } });
    const r2 = mergeContext(r1, { identifiers: { meta: { fbp: 'fbp.2.222.2' } } });
    expect(r2.identifiers.meta.fbp.value).toBe('fbp.2.222.2');
    expect(r2.identifiers.meta.fbp.firstSeenAt).toBeDefined();
    const r3 = mergeContext(r2, { identifiers: { meta: { fbp: '' } } });
    expect(r3.identifiers.meta.fbp.value).toBe('fbp.2.222.2'); // empty never clears
  });

  it('merges provider namespaces independently', () => {
    const r1 = mergeContext(null, { identifiers: { meta: { fbp: 'fbp.x' } } });
    const r2 = mergeContext(r1, { identifiers: { google: { gaClientId: 'G-1' } } });
    expect(r2.identifiers.meta.fbp.value).toBe('fbp.x');
    expect(r2.identifiers.google.gaClientId.value).toBe('G-1');
  });

  it('updates url/referrer to the latest non-empty value', () => {
    const r1 = mergeContext(null, { url: '/a', referrer: '/r1' });
    const r2 = mergeContext(r1, { url: '/b' });
    expect(r2.url).toBe('/b');
    expect(r2.referrer).toBe('/r1');
  });

  it('purity: second merge does not mutate first result', () => {
    const r1 = mergeContext(null, { identifiers: { meta: { fbp: 'fbp.1' } } });
    const r1Copy = { identifiers: { meta: { fbp: r1.identifiers.meta.fbp } }, url: r1.url, referrer: r1.referrer };
    const r2 = mergeContext(r1, { identifiers: { meta: { fbp: 'fbp.2' } } });
    expect(r2.identifiers.meta.fbp.value).toBe('fbp.2');
    expect(r1Copy.identifiers.meta.fbp.value).toBe('fbp.1');
  });

  it('input guard: non-string values are skipped', () => {
    const r = mergeContext(null, { identifiers: { meta: { fbp: { value: 'x' } as any } } });
    expect(r.identifiers.meta.fbp).toBeUndefined();
  });
});