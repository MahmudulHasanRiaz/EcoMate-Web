import {
  deriveTimelineSource,
  withTimelineSources,
} from './timeline-source';

describe('deriveTimelineSource', () => {
  it('classifies explicit courier entries as courier', () => {
    expect(
      deriveTimelineSource({
        type: 'courier',
        courier: 'pathao',
        status: 'DISPATCHED',
        timestamp: '2026-01-01T00:00:00Z',
      }),
    ).toBe('courier');
  });

  it('classifies entries carrying a courier name (no type) as courier', () => {
    expect(deriveTimelineSource({ courier: 'redx', status: 'PICKED_UP' })).toBe(
      'courier',
    );
  });

  it('classifies a staff email actor as staff', () => {
    expect(
      deriveTimelineSource({
        type: 'note',
        note: 'Called the customer',
        performedBy: 'staff@shop.com',
      }),
    ).toBe('staff');
  });

  it('classifies a raw user id actor as staff', () => {
    expect(deriveTimelineSource({ type: 'note', by: 'user-42' })).toBe('staff');
  });

  it('treats the System marker as system regardless of casing', () => {
    expect(deriveTimelineSource({ performedBy: 'System' })).toBe('system');
    expect(deriveTimelineSource({ performedBy: 'system' })).toBe('system');
  });

  it('treats the Customer marker as system', () => {
    expect(deriveTimelineSource({ performedBy: 'Customer' })).toBe('system');
  });

  it('classifies actor-less status entries as system', () => {
    expect(
      deriveTimelineSource({
        status: 'Pending',
        timestamp: '2026-01-01T00:00:00Z',
        note: 'Order created',
      }),
    ).toBe('system');
  });

  it('tolerates malformed entries', () => {
    expect(deriveTimelineSource(null)).toBe('system');
    expect(deriveTimelineSource('note')).toBe('system');
    expect(deriveTimelineSource(42)).toBe('system');
  });
});

describe('withTimelineSources', () => {
  it('attaches a source to every entry and preserves the payload', () => {
    const out = withTimelineSources([
      { status: 'Pending', note: 'Order created' },
      { type: 'courier', courier: 'pathao', status: 'DISPATCHED' },
      { type: 'note', performedBy: 'staff@shop.com', note: 'hi' },
    ]);

    expect(out.map((e) => e.source)).toEqual(['system', 'courier', 'staff']);
    expect(out[0].note).toBe('Order created');
    expect(out[1].courier).toBe('pathao');
  });

  it('returns [] for non-array input', () => {
    expect(withTimelineSources(undefined)).toEqual([]);
    expect(withTimelineSources(null)).toEqual([]);
    expect(withTimelineSources({})).toEqual([]);
  });
});
