import { describe, it, expect } from 'vitest';
import { transformBackendProduct } from '../products';

const baseRaw = {
  id: 'p1',
  name: 'Panjabi',
  basePrice: 2250,
  images: ['/a.jpg'],
  type: 'simple',
};

describe('transformBackendProduct — PDP fields', () => {
  it('maps videoUrl and detailRows through', () => {
    const p = transformBackendProduct({
      ...baseRaw,
      videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
      detailRows: [{ label: 'Fabric', value: 'Popcorn' }],
    });
    expect(p.videoUrl).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(p.detailRows).toEqual([{ label: 'Fabric', value: 'Popcorn' }]);
  });

  it('leaves them undefined when backend sends nothing (no crash)', () => {
    const p = transformBackendProduct({ ...baseRaw });
    expect(p.videoUrl).toBeUndefined();
    expect(p.detailRows).toBeUndefined();
  });

  it('passes descriptionSections through for section rendering', () => {
    const sections = {
      tagline: 'Festive essential',
      benefits: ['Soft & breathable'],
      specifications: '<p>100% cotton</p>',
      stylingTip: 'Pair it with white pajama',
    };
    const p = transformBackendProduct({ ...baseRaw, descriptionSections: sections });
    expect(p.descriptionSections).toEqual(sections);
  });

  it('leaves descriptionSections undefined when absent (all sections hide)', () => {
    expect(transformBackendProduct({ ...baseRaw }).descriptionSections).toBeUndefined();
  });
});
