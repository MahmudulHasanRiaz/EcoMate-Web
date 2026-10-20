import {
  findPartialTransition,
  resolvePartialRecognition,
} from '../metric-contract';

const at = (iso: string) => new Date(iso);

describe('findPartialTransition', () => {
  it('returns the latest Partial transition', () => {
    const timeline = [
      { status: 'Delivered', timestamp: '2026-10-01T00:00:00Z' },
      { status: 'Partial', timestamp: '2026-10-03T00:00:00Z' },
      { status: 'Partial', timestamp: '2026-10-05T00:00:00Z' },
    ];
    expect(findPartialTransition(timeline)?.timestamp).toBe('2026-10-05T00:00:00Z');
  });

  it('returns null without a Partial entry', () => {
    expect(
      findPartialTransition([
        { status: 'Delivered', timestamp: '2026-10-01T00:00:00Z' },
      ]),
    ).toBeNull();
  });
});

describe('resolvePartialRecognition', () => {
  it('recognises a Partial order with a dated Partial transition', () => {
    const r = resolvePartialRecognition('Partial', [
      { status: 'Delivered', timestamp: '2026-10-01T00:00:00Z' },
      { status: 'Partial', timestamp: '2026-10-03T00:00:00Z' },
    ]);
    expect(r).toEqual({ recognised: true, partialAt: at('2026-10-03T00:00:00Z') });
  });

  it('stays unrecognised when the Partial transition has no usable date', () => {
    const r = resolvePartialRecognition('Partial', [
      { status: 'Partial', timestamp: 'not-a-date' as unknown as string },
    ]);
    expect(r).toEqual({ recognised: false, partialAt: null });
  });

  it('stays unrecognised without a transition (status alone never invents a date)', () => {
    expect(resolvePartialRecognition('Partial', [])).toEqual({
      recognised: false,
      partialAt: null,
    });
  });

  it('is only about the Partial status', () => {
    expect(
      resolvePartialRecognition('Delivered', [
        { status: 'Partial', timestamp: '2026-10-03T00:00:00Z' },
      ]),
    ).toEqual({ recognised: false, partialAt: null });
  });
});
