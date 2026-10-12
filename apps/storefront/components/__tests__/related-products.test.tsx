import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StorefrontConfigProvider } from '@/context/StorefrontConfigContext';
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { WishlistProvider } from '@/context/WishlistContext';
import type { StorefrontConfig } from '@/lib/api/storefront-config';
import apiClient from '@/lib/api-client';
import RelatedProducts from '../RelatedProducts';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/api/auth', () => ({ getMe: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/api-client', () => ({ default: { get: vi.fn() } }));

const mockedGet = vi.mocked(apiClient.get);

const CONFIG = {
  currency: { code: 'BDT', symbol: '৳' },
  delivery: { charge: 0, freeDeliveryMin: 0 },
  features: {},
  order: { whatsapp: '', callNumber: '' },
  social: { whatsapp: '' },
  store: { phone: '' },
  licenseFeatures: [],
} as unknown as StorefrontConfig;

const baseProduct = {
  id: 'p0',
  name: 'Base Panjabi',
  slug: 'base',
  price: 1000,
  image: '/base.jpg',
  images: ['/base.jpg'],
  type: 'simple',
  stock: 5,
  category: 'Panjabi',
  categorySlug: 'panjabi',
  tags: ['cotton'],
} as any;

const initialItems = [
  { ...baseProduct, id: 'r1', slug: 'r1', name: 'SSR Related One' },
  { ...baseProduct, id: 'r2', slug: 'r2', name: 'SSR Related Two' },
];

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <AuthProvider>
      <CartProvider>
        <WishlistProvider>
          <StorefrontConfigProvider initialConfig={CONFIG}>{ui}</StorefrontConfigProvider>
        </WishlistProvider>
      </CartProvider>
    </AuthProvider>,
  );
}

describe('RelatedProducts initialItems (P0/P1-7)', () => {
  it('renders SSR-provided items without a client fetch (zero browser /api calls)', () => {
    mockedGet.mockClear();
    renderWithProviders(<RelatedProducts product={baseProduct} initialItems={initialItems} />);

    // mobile carousel + desktop grid both render the same items
    expect(screen.getAllByText('SSR Related One')).toHaveLength(2);
    expect(screen.getAllByText('SSR Related Two')).toHaveLength(2);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('falls back to client fetch when no initialItems are provided', async () => {
    mockedGet.mockClear();
    mockedGet.mockResolvedValueOnce({
      data: { data: [{ ...baseProduct, id: 'c1', slug: 'c1', name: 'Client Related' }] },
    } as any);
    renderWithProviders(<RelatedProducts product={baseProduct} />);

    await waitFor(() => expect(screen.getAllByText('Client Related')).toHaveLength(2));
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});
