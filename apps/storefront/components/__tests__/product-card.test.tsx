import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StorefrontConfigProvider } from '@/context/StorefrontConfigContext';
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { WishlistProvider } from '@/context/WishlistContext';
import type { StorefrontConfig } from '@/lib/api/storefront-config';
import ProductCard from '../ProductCard';

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

const saleProduct = {
  id: 'p1',
  name: 'Elegant Embroidered Panjabi (EEP-5)',
  slug: 'eep-5',
  price: 1590,
  originalPrice: 2150,
  saveAmount: 560,
  image: '/a.jpg',
  images: ['/a.jpg'],
  type: 'simple',
  stock: 10,
  availabilityMode: 'MANAGED_STOCK',
} as any;

function renderCard(product: any = saleProduct) {
  return render(
    <StorefrontConfigProvider initialConfig={CONFIG}>
      <AuthProvider>
        <CartProvider>
          <WishlistProvider>
            <ProductCard product={product} />
          </WishlistProvider>
        </CartProvider>
      </AuthProvider>
    </StorefrontConfigProvider>,
  );
}

describe('ProductCard mockup style', () => {
  it('shows title, price + strike + Save badge + ADD TO CART', () => {
    renderCard();
    expect(screen.getByText('Elegant Embroidered Panjabi (EEP-5)')).toBeDefined();
    expect(screen.getByText(/Save 26%/)).toBeDefined();
    expect(screen.getByText('ADD TO CART')).toBeDefined();
  });

  it('shows Out of Stock state instead of CTA when unavailable', () => {
    renderCard({ ...saleProduct, stock: 0 });
    expect(screen.getAllByText('Out of Stock').length).toBeGreaterThan(0);
    expect(screen.queryByText('ADD TO CART')).toBeNull();
  });
});
