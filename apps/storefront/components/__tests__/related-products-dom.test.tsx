import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StorefrontConfigProvider } from '@/context/StorefrontConfigContext';
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { WishlistProvider } from '@/context/WishlistContext';
import type { StorefrontConfig } from '@/lib/api/storefront-config';
import type { ProductCardData } from '@/lib/types';
import RelatedProducts from '../RelatedProducts';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/api/auth', () => ({ getMe: vi.fn().mockResolvedValue(null) }));

const CONFIG = {
  currency: { code: 'BDT', symbol: '৳' },
  delivery: { charge: 0, freeDeliveryMin: 0 },
  features: {},
  order: { whatsapp: '', callNumber: '' },
  social: { whatsapp: '' },
  store: { phone: '' },
  licenseFeatures: [],
} as unknown as StorefrontConfig;

const card = (id: string, name: string): ProductCardData => ({
  id,
  name,
  slug: id,
  price: 100,
  image: '/a.jpg',
  category: 'Cat',
  hasVariants: false,
  variantCount: 0,
  anyVariantInStock: false,
  stock: 5,
  availabilityMode: 'MANAGED_STOCK',
  type: 'simple',
});

describe('RelatedProducts DOM (P2 dedupe)', () => {
  it('renders each related product exactly once (no mobile+desktop duplicate)', () => {
    const { container } = render(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <AuthProvider>
          <CartProvider>
            <WishlistProvider>
              <RelatedProducts
                product={{ id: 'self', name: 'Self' } as any}
                initialItems={[card('r1', 'Related One'), card('r2', 'Related Two')]}
              />
            </WishlistProvider>
          </CartProvider>
        </AuthProvider>
      </StorefrontConfigProvider>,
    );
    // Pre-P2 this asserted 2: the list rendered a mobile row AND a
    // desktop grid with the same cards.
    expect(screen.getAllByText('Related One')).toHaveLength(1);
    expect(screen.getAllByText('Related Two')).toHaveLength(1);
    console.log(`RELATED_DOM_ELEMENTS=${container.querySelectorAll('*').length} for 2 cards`);
  });
});
