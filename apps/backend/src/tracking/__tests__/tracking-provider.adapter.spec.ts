import {
  TrackingProviderAdapter,
  getAdapter,
  listAdapters,
  registerAdapter,
} from '../adapters';
import {
  TrackingContextView,
  TrackingSnapshotPayload,
} from '../tracking-snapshot.types';
import { TrackingNormalizer } from '../tracking.normalizer';

/** Minimal fake adapter used to exercise registry semantics. */
const fakeAdapter = (provider: string, version: number): TrackingProviderAdapter => ({
  provider,
  version,
  providerApiVersion: `${provider}-api-v${version}`,
  supports: (eventType: string) => eventType === 'Purchase',
  build: (
    _snapshot: TrackingSnapshotPayload,
    _ctx: TrackingContextView,
    _normalizer: TrackingNormalizer,
  ) => ({
    eventName: 'Purchase',
    eventId: `${provider}-${version}`,
    eventTime: Date.now(),
    eventType: 'Purchase',
  }),
  send: async () => ({
    ok: true,
    retryable: false,
    providerEventId: 'evt-1',
    httpStatus: 200,
  }),
});

describe('TrackingProviderAdapter + versioned registry (design §4.2/4.3)', () => {
  it('getAdapter returns a registered adapter for its provider', () => {
    const adapter = fakeAdapter('fake-single', 1);
    registerAdapter(adapter);

    expect(getAdapter('fake-single')).toBe(adapter);
    expect(getAdapter('fake-single', 1)).toBe(adapter);
  });

  it('getAdapter without a version returns the newest registered for that provider', () => {
    const v1 = fakeAdapter('fake-newest', 1);
    const v2 = fakeAdapter('fake-newest', 2);
    registerAdapter(v1);
    registerAdapter(v2);

    expect(getAdapter('fake-newest')).toBe(v2);
  });

  it('getAdapter with an unknown version falls back to the newest', () => {
    const v1 = fakeAdapter('fake-fallback', 1);
    const v2 = fakeAdapter('fake-fallback', 2);
    const v3 = fakeAdapter('fake-fallback', 3);
    registerAdapter(v1);
    registerAdapter(v2);
    registerAdapter(v3);

    expect(getAdapter('fake-fallback', 999)).toBe(v3);
    expect(getAdapter('fake-fallback', 2)).toBe(v2);
    // newest-last ordering is preserved within a provider's version list
    const versions = listAdapters()
      .filter((a) => a.provider === 'fake-fallback')
      .map((a) => a.version);
    expect(versions).toEqual([1, 2, 3]);
  });

  it('getAdapter returns undefined for an unregistered provider', () => {
    expect(getAdapter('fake-missing')).toBeUndefined();
    expect(getAdapter('fake-missing', 1)).toBeUndefined();
  });

  it('adapter supports() gates which event types it will build', () => {
    const adapter = fakeAdapter('fake-gate', 1);

    expect(adapter.supports('Purchase')).toBe(true);
    expect(adapter.supports('ViewContent')).toBe(false);
  });

  it('listAdapters returns every registered adapter', () => {
    const adapter = fakeAdapter('fake-list', 1);
    registerAdapter(adapter);

    const all = listAdapters();
    expect(all).toContain(adapter);
    expect(all.filter((a) => a.provider === 'fake-list')).toEqual([adapter]);
  });
});
