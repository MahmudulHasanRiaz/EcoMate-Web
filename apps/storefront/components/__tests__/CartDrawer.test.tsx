import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StorefrontConfigProvider } from '@/context/StorefrontConfigContext';
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider, useCart } from '@/context/CartContext';
import type { StorefrontConfig } from '@/lib/api/storefront-config';
import type { CartItem } from '@/lib/types';
import CartDrawer from '../CartDrawer';

const { pushMock, getProductsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  getProductsMock: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/',
}));
vi.mock('@/lib/api/products', () => ({ getProducts: getProductsMock }));
vi.mock('@/lib/api/auth', () => ({ getMe: vi.fn().mockResolvedValue(null) }));

const CONFIG = {
  store: { name: 'Store' },
  currency: { code: 'BDT', symbol: '৳' },
  delivery: { freeDeliveryMin: 0 },
  features: {},
  menu: { header: { items: [] }, mobile: { items: [] }, footer: { columns: [] } },
  licenseFeatures: [],
} as unknown as StorefrontConfig;

const ITEM: CartItem = { id: 'p1', name: 'Test Product', price: 100, quantity: 1 };

function Probe() {
  const { addToCart, setIsCartOpen, isCartOpen } = useCart();
  return (
    <div>
      <button onClick={() => addToCart(ITEM)}>add</button>
      <button onClick={() => setIsCartOpen(false)}>close</button>
      <span data-testid="open-state">{isCartOpen ? 'open' : 'closed'}</span>
    </div>
  );
}

function renderDrawer() {
  return render(
    <StorefrontConfigProvider initialConfig={CONFIG}>
      <AuthProvider>
        <CartProvider>
          <Probe />
          <CartDrawer />
        </CartProvider>
      </AuthProvider>
    </StorefrontConfigProvider>
  );
}

describe('CartDrawer', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('locks body scroll while open and restores it on close (mobile scroll bleed fix)', () => {
    renderDrawer();
    expect(document.body.style.overflow).toBe('');

    fireEvent.click(screen.getByText('add'));
    expect(screen.getByTestId('open-state').textContent).toBe('open');
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getByText('close'));
    expect(document.body.style.overflow).toBe('');
  });

  it('stays mounted and slides in/out instead of popping (single animation owner)', () => {
    const { container } = renderDrawer();
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.className).toContain('translate-x-full');

    fireEvent.click(screen.getByText('add'));
    expect(dialog.className).toContain('translate-x-0');

    fireEvent.click(screen.getByText('close'));
    expect(dialog.className).toContain('translate-x-full');
  });

  it('runs the checkout pulse a bounded number of times, never infinitely', () => {
    renderDrawer();
    fireEvent.click(screen.getByText('add'));
    const checkout = screen.getByText('Checkout');
    expect(checkout.className).toContain('animate-[bump_1.5s_ease-in-out_2]');
    expect(checkout.className).not.toContain('infinite');
  });

  it('renders the cart content area with overscroll containment', () => {
    renderDrawer();
    fireEvent.click(screen.getByText('add'));
    expect(document.querySelector('.overscroll-contain')).toBeTruthy();
  });
});
