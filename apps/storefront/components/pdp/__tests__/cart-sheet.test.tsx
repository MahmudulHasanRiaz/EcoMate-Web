import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CartVariantSheet } from '../CartVariantSheet';
import { StickyBar } from '../StickyBar';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const variant = {
  id: 'v1',
  sku: 'SKU-M',
  price: 2250,
  regularPrice: 2250,
  stock: 10,
  isActive: true,
  attributeValues: [
    { attributeValue: { attribute: { name: 'Size' }, value: 'M' } },
    { attributeValue: { attribute: { name: 'Color' }, value: 'Black' } },
  ],
} as any;

const product = {
  id: 'p1',
  name: 'Panjabi',
  slug: 'panjabi',
  price: 2250,
  type: 'variable',
  image: '/a.jpg',
  variants: [variant],
} as any;

function sheetProps(over: any = {}) {
  return {
    product,
    displayPrice: 2250,
    selectedVariant: null,
    selectedAttrs: {},
    qty: 1,
    quantity: 1,
    inCart: false,
    justAdded: false,
    hintText: null,
    isVariable: true,
    colorAttrName: null,
    sizeChartData: null,
    onSelectVariant: vi.fn(),
    onSelectAttr: vi.fn(),
    onDec: vi.fn(),
    onInc: vi.fn(),
    onAddToCart: vi.fn(),
    onBuyNow: vi.fn(),
    onSizeGuide: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

describe('CartVariantSheet', () => {
  it('renders header, selectors and both CTAs', () => {
    render(<CartVariantSheet {...sheetProps()} />);
    expect(screen.getAllByText('Panjabi').length).toBeGreaterThan(0);
    expect(screen.getByText('ADD TO CART')).toBeDefined();
    expect(screen.getByText('ORDER NOW')).toBeDefined();
  });

  it('shows inline hint instead of toast', () => {
    render(<CartVariantSheet {...sheetProps({ hintText: 'Please select a size to continue.' })} />);
    expect(screen.getByText('Please select a size to continue.')).toBeDefined();
  });

  it('shows confirmation with continue + view cart after add', () => {
    render(<CartVariantSheet {...sheetProps({ justAdded: true })} />);
    expect(screen.getByText('Added to cart')).toBeDefined();
    expect(screen.getByText('CONTINUE SHOPPING')).toBeDefined();
    const viewCart = screen.getByText('VIEW CART');
    expect(viewCart.closest('a')?.getAttribute('href')).toBe('/cart');
  });

  it('continue shopping closes the sheet', () => {
    const p = sheetProps({ justAdded: true });
    render(<CartVariantSheet {...p} />);
    fireEvent.click(screen.getByText('CONTINUE SHOPPING'));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('StickyBar', () => {
  it('opens the sheet from both buttons without scrolling', () => {
    const onOpenSheet = vi.fn();
    render(<StickyBar isOutOfStock={false} visible onOpenSheet={onOpenSheet} />);
    fireEvent.click(screen.getByText('ADD TO CART'));
    fireEvent.click(screen.getByText('ORDER NOW'));
    expect(onOpenSheet).toHaveBeenCalledTimes(2);
  });

  it('uses distinct icons per action', () => {
    render(<StickyBar isOutOfStock={false} visible onOpenSheet={vi.fn()} />);
    const bar = screen.getByTestId('sticky-bar');
    const svgs = bar.querySelectorAll('svg');
    const classes = [...svgs].map((s) => s.getAttribute('class') || '');
    expect(new Set(classes).size).toBeGreaterThan(1);
  });

  it('disables actions when out of stock', () => {
    render(<StickyBar isOutOfStock visible onOpenSheet={vi.fn()} />);
    expect(screen.getByText('Out of Stock')).toBeDefined();
    expect(screen.queryByText('ADD TO CART')).toBeNull();
  });
});
