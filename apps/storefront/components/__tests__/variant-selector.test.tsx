import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VariantSelector } from '../VariantSelector';

const sizeVar = (id: string, size: string) => ({
  id,
  sku: `SKU-${size}`,
  price: 1000,
  regularPrice: 1000,
  stock: 5,
  isActive: true,
  attributeValues: [
    { attributeValue: { id: `c-${id}`, value: 'Black', attribute: { id: 'a1', name: 'Color' } } },
    { attributeValue: { id: `s-${id}`, value: size, attribute: { id: 'a2', name: 'Size' } } },
  ],
});

describe('VariantSelector swatches', () => {
  it('renders color group before size group regardless of data order', () => {
    const variants = [
      { ...sizeVar('v1', 'M'), attributeValues: [...sizeVar('v1', 'M').attributeValues].reverse() },
      sizeVar('v2', 'L'),
    ] as any;
    render(
      <VariantSelector variants={variants} selectedVariant={null} selectedAttrs={{}} onSelect={vi.fn()} onSelectAttr={vi.fn()} />,
    );
    const labels = screen.getAllByText(/:$/).map((el) => el.textContent);
    expect(labels[0]).toMatch(/Color/i);
    expect(labels[1]).toMatch(/Size/i);
  });

  it('renders image boxes when the value has an image, hex fallback otherwise', () => {
    const variants = [
      {
        ...sizeVar('v1', 'M'),
        attributeValues: [
          { attributeValue: { id: 'c-v1', value: 'Black', image: '/sw/black.jpg', attribute: { id: 'a1', name: 'Color', swatchFit: 'contain' } } },
          { attributeValue: { id: 's-v1', value: 'M', attribute: { id: 'a2', name: 'Size' } } },
        ],
      },
    ] as any;
    render(
      <VariantSelector variants={variants} selectedVariant={null} selectedAttrs={{}} onSelect={vi.fn()} onSelectAttr={vi.fn()} />,
    );
    const img = screen.getByLabelText('Black').querySelector('img');
    expect(img?.getAttribute('src')).toBe('/sw/black.jpg');
    expect(img?.className).toContain('object-contain');
  });

  it('selects the tapped swatch', () => {
    const onSelectAttr = vi.fn();
    const variants = [sizeVar('v1', 'M')] as any;
    render(
      <VariantSelector variants={variants} selectedVariant={null} selectedAttrs={{}} onSelect={vi.fn()} onSelectAttr={onSelectAttr} />,
    );
    fireEvent.click(screen.getByLabelText('Black'));
    expect(onSelectAttr).toHaveBeenCalledWith('Color', 'Black');
  });
});
