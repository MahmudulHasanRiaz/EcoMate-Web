import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StorefrontConfigProvider } from '@/context/StorefrontConfigContext';
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { WishlistProvider } from '@/context/WishlistContext';
import type { StorefrontConfig } from '@/lib/api/storefront-config';
import Header from '../Header';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/api/auth', () => ({ getMe: vi.fn().mockResolvedValue(null) }));

const CONFIG = {
  currency: { code: 'BDT', symbol: '৳' },
  delivery: { charge: 60, freeDeliveryMin: 3000 },
  features: {},
  menu: { header: { items: [] }, mobile: { items: [] }, footer: { columns: [] } },
  order: { whatsapp: '', callNumber: '' },
  social: { whatsapp: '' },
  store: { name: 'EcoMate', phone: '' },
  licenseFeatures: [],
} as unknown as StorefrontConfig;

function renderHeader(config: any = CONFIG) {
  return render(
    <StorefrontConfigProvider initialConfig={config as StorefrontConfig}>
      <AuthProvider>
        <CartProvider>
          <WishlistProvider>
            <Header />
          </WishlistProvider>
        </CartProvider>
      </AuthProvider>
    </StorefrontConfigProvider>,
  );
}

describe('Header announcement bar', () => {
  it('shows free-delivery threshold + COD text from config', () => {
    renderHeader();
    expect(screen.getByText(/Free delivery over ৳3,000/)).toBeDefined();
    expect(screen.getByText(/Cash on Delivery across Bangladesh/)).toBeDefined();
  });

  it('omits the threshold when freeDeliveryMin is 0', () => {
    renderHeader({ ...CONFIG, delivery: { charge: 60, freeDeliveryMin: 0 } });
    expect(screen.queryByText(/Free delivery over/)).toBeNull();
    expect(screen.getByText(/Cash on Delivery across Bangladesh/)).toBeDefined();
  });
});
