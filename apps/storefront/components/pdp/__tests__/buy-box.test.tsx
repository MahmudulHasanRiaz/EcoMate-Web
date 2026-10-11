import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { StorefrontConfig } from '@/lib/api/storefront-config';
import { BuyBox, type BuyBoxProps } from '../BuyBox';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const CONFIG = {
  currency: { code: 'BDT', symbol: '৳' },
  delivery: { charge: 60, freeDeliveryMin: 3000 },
  deliveryInfo: {
    enabled: true,
    title: '',
    rows: [
      { label: 'Inside Dhaka', value: '1–2 business days' },
      { label: 'Outside Dhaka', value: '3–5 business days' },
      { label: 'Payment', value: 'Cash on Delivery' },
    ],
  },
  order: { whatsapp: '8801516774099', callNumber: '8801516774099' },
  social: { whatsapp: '' },
  store: { phone: '' },
} as unknown as StorefrontConfig;

const baseProduct = {
  id: 'p1',
  name: 'Embroidery Popcorn Panjabi – Jet Black',
  slug: 'epp-06',
  price: 2250,
  sku: 'EPP-06',
  type: 'simple',
  shortDesc: 'Premium popcorn-fabric panjabi.',
  tags: [],
} as any;

function props(over: Partial<BuyBoxProps> = {}): BuyBoxProps {
  return {
    product: baseProduct,
    config: CONFIG,
    isVariable: false,
    colorAttrName: null,
    selectedVariant: null,
    selectedAttrs: {},
    displayPrice: 2250,
    displayStock: 24,
    isOutOfStock: false,
    qty: 1,
    quantity: 1,
    inCart: false,
    justAdded: false,
    sizeChartData: null,
    showSizeHint: false,
    wishlisted: false,
    copied: false,
    shareUrl: '',
    shareText: 'x',
    waHref: 'https://wa.me/8801516774099',
    callHref: 'tel:+8801516774099',
    onSelectVariant: vi.fn(),
    onSelectAttr: vi.fn(),
    onDec: vi.fn(),
    onInc: vi.fn(),
    onAddToCart: vi.fn(),
    onBuyNow: vi.fn(),
    onWishlist: vi.fn(),
    onCopyLink: vi.fn(),
    onSizeGuide: vi.fn(),
    ...over,
  };
}

describe('BuyBox', () => {
  it('renders code, title, price and one-line stock text', () => {
    render(<BuyBox {...props()} />);
    expect(screen.getByText('Code: EPP-06')).toBeDefined();
    expect(screen.getByText('Embroidery Popcorn Panjabi – Jet Black')).toBeDefined();
    expect(screen.getByText('In Stock · Only 24 left')).toBeDefined();
  });

  it('shows urgency text for low stock', () => {
    render(<BuyBox {...props({ displayStock: 5 })} />);
    expect(screen.getByText('Only 5 left!')).toBeDefined();
  });

  it('shows inline size hint when requested', () => {
    render(<BuyBox {...props({ showSizeHint: true })} />);
    expect(screen.getByText('Please select a size to continue.')).toBeDefined();
  });

  it('orders ORDER NOW before ADD TO CART', () => {
    render(<BuyBox {...props()} />);
    const orderNow = screen.getByText('ORDER NOW');
    const addToCart = screen.getByText('ADD TO CART');
    expect(orderNow.compareDocumentPosition(addToCart)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('shows WhatsApp + Call actions and delivery rows', () => {
    render(<BuyBox {...props()} />);
    expect(screen.getByText('ORDER VIA WHATSAPP')).toBeDefined();
    expect(screen.getByText('CALL')).toBeDefined();
    expect(screen.getByText('Inside Dhaka')).toBeDefined();
    expect(screen.getByText('1–2 business days')).toBeDefined();
  });

  it('hides delivery card when disabled', () => {
    const cfg = { ...CONFIG, deliveryInfo: { enabled: false, title: '', rows: [] } } as unknown as StorefrontConfig;
    render(<BuyBox {...props({ config: cfg })} />);
    expect(screen.queryByText('Inside Dhaka')).toBeNull();
  });

  it('renders disabled OUT OF STOCK CTA when out of stock', () => {
    render(<BuyBox {...props({ isOutOfStock: true, displayStock: 0 })} />);
    expect(screen.getByText('OUT OF STOCK')).toBeDefined();
    expect(screen.queryByText('ADD TO CART')).toBeNull();
  });

  it('shows styling tip only when present', () => {
    const { rerender } = render(<BuyBox {...props()} />);
    expect(screen.queryByText(/Pair it with/)).toBeNull();
    rerender(
      <BuyBox
        {...props({
          product: {
            ...baseProduct,
            descriptionSections: { stylingTip: 'Pair it with white pajama' },
          },
        })}
      />,
    );
    expect(screen.getByText(/Pair it with white pajama/)).toBeDefined();
  });

  it('fires CTA + wishlist handlers', () => {
    const p = props();
    render(<BuyBox {...p} />);
    fireEvent.click(screen.getByText('ADD TO CART'));
    expect(p.onAddToCart).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('ORDER NOW'));
    expect(p.onBuyNow).toHaveBeenCalledTimes(1);
  });
});
