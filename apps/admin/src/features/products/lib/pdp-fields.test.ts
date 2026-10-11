import { describe, it, expect } from 'vitest';
import { isSupportedVideoUrl, cleanDetailRows, cleanDescriptionSections } from './pdp-fields';

describe('pdp-fields', () => {
  it('accepts empty (optional) + YouTube/Facebook urls', () => {
    expect(isSupportedVideoUrl('')).toBe(true);
    expect(isSupportedVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isSupportedVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isSupportedVideoUrl('https://www.facebook.com/watch/?v=123456789')).toBe(true);
  });

  it('rejects arbitrary urls', () => {
    expect(isSupportedVideoUrl('https://evil.example/x')).toBe(false);
    expect(isSupportedVideoUrl('not a url')).toBe(false);
  });

  it('cleans detail rows, drops empties, preserves order', () => {
    expect(
      cleanDetailRows([
        { label: ' Fabric ', value: ' Popcorn ' },
        { label: '', value: 'x' },
        { label: 'Color', value: '' },
        { label: 'Fit', value: 'Regular' },
      ]),
    ).toEqual([
      { label: 'Fabric', value: 'Popcorn' },
      { label: 'Fit', value: 'Regular' },
    ]);
  });

  it('normalizes description sections and omits empties', () => {
    expect(
      cleanDescriptionSections({
        tagline: ' Festive essential ',
        benefits: [' Soft ', '', '  '],
        specifications: '',
        stylingTip: 'Pair it well',
      }),
    ).toEqual({
      tagline: 'Festive essential',
      benefits: ['Soft'],
      stylingTip: 'Pair it well',
    });
  });

  it('returns undefined when the whole sections group is empty', () => {
    expect(
      cleanDescriptionSections({ tagline: '  ', benefits: ['', ' '], specifications: '', stylingTip: '' }),
    ).toBeUndefined();
  });
});
