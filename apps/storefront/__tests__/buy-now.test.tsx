import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CartProvider, useCart } from '../context/CartContext';
import type { CartItem } from '../lib/types';

function item(over: Partial<CartItem> = {}): CartItem {
  return {
    id: 'p-1',
    name: 'Test Product',
    price: 100,
    image: '',
    quantity: 1,
    stock: 10,
    availabilityMode: 'MANAGED_STOCK',
    ...over,
  };
}

function Harness() {
  const {
    addToCart,
    updateQuantity,
    clearCart,
    items,
    cartCount,
    startBuyNow,
    updateBuyNowQuantity,
    removeBuyNow,
    clearBuyNow,
    buyNowItem,
  } = useCart();
  return (
    <div>
      <div data-testid="items">{JSON.stringify(items)}</div>
      <div data-testid="count">{cartCount}</div>
      <div data-testid="buynow">{JSON.stringify(buyNowItem)}</div>
      <button onClick={() => addToCart(item())}>add-cart</button>
      <button onClick={() => startBuyNow(item())}>buy-now</button>
      <button onClick={() => startBuyNow(item({ id: 'p-2', name: 'Other' }))}>buy-now-other</button>
      <button onClick={() => updateBuyNowQuantity(3)}>buynow-qty-3</button>
      <button onClick={() => updateBuyNowQuantity(0)}>buynow-qty-0</button>
      <button onClick={() => removeBuyNow()}>buynow-remove</button>
      <button onClick={() => clearBuyNow()}>buynow-clear</button>
      <button onClick={() => updateQuantity('p-1', 9)}>cart-qty-9</button>
      <button onClick={() => clearCart()}>cart-clear</button>
    </div>
  );
}

function renderHarness() {
  return render(
    <CartProvider>
      <Harness />
    </CartProvider>,
  );
}

function cart(): CartItem[] {
  return JSON.parse(screen.getByTestId('items').textContent || '[]');
}

function buyNow(): CartItem | null {
  return JSON.parse(screen.getByTestId('buynow').textContent || 'null');
}

describe('CartContext Buy Now isolation', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('starts a Buy Now with exactly quantity 1', () => {
    renderHarness();
    fireEvent.click(screen.getByText('buy-now'));
    expect(buyNow()).toMatchObject({ id: 'p-1', quantity: 1 });
  });

  it('does not touch the shared cart when Buy Now starts', () => {
    renderHarness();
    fireEvent.click(screen.getByText('add-cart'));
    fireEvent.click(screen.getByText('buy-now'));
    expect(cart()).toHaveLength(1);
    expect(cart()[0].quantity).toBe(1);
    expect(buyNow()).toMatchObject({ id: 'p-1', quantity: 1 });
  });

  it('repeat Buy Now replaces instead of merging (no doubling)', () => {
    renderHarness();
    // First Buy Now with an existing cart item for the same product
    fireEvent.click(screen.getByText('add-cart'));
    fireEvent.click(screen.getByText('buy-now'));
    // Shopper goes back and clicks Buy Now again — still exactly 1
    fireEvent.click(screen.getByText('buy-now'));
    fireEvent.click(screen.getByText('buy-now'));
    expect(buyNow()).toMatchObject({ id: 'p-1', quantity: 1 });
    // Cart quantity untouched throughout
    expect(cart()[0].quantity).toBe(1);
  });

  it('a second Buy Now on another product replaces the first', () => {
    renderHarness();
    fireEvent.click(screen.getByText('buy-now'));
    fireEvent.click(screen.getByText('buy-now-other'));
    expect(buyNow()).toMatchObject({ id: 'p-2', quantity: 1 });
  });

  it('Buy Now quantity changes only via its own updater', () => {
    renderHarness();
    fireEvent.click(screen.getByText('add-cart'));
    fireEvent.click(screen.getByText('buy-now'));
    fireEvent.click(screen.getByText('buynow-qty-3'));
    expect(buyNow()).toMatchObject({ quantity: 3 });
    // Cart item left alone
    expect(cart()[0].quantity).toBe(1);
  });

  it('setting Buy Now quantity to 0 removes it (falls back to cart)', () => {
    renderHarness();
    fireEvent.click(screen.getByText('buy-now'));
    fireEvent.click(screen.getByText('buynow-qty-0'));
    expect(buyNow()).toBeNull();
  });

  it('removeBuyNow / clearBuyNow clear only the Buy Now item', () => {
    renderHarness();
    fireEvent.click(screen.getByText('add-cart'));
    fireEvent.click(screen.getByText('buy-now'));
    fireEvent.click(screen.getByText('buynow-remove'));
    expect(buyNow()).toBeNull();
    expect(cart()).toHaveLength(1);

    fireEvent.click(screen.getByText('buy-now'));
    fireEvent.click(screen.getByText('buynow-clear'));
    expect(buyNow()).toBeNull();
    expect(cart()).toHaveLength(1);
  });

  it('clearCart does not clear a pending Buy Now item', () => {
    renderHarness();
    fireEvent.click(screen.getByText('add-cart'));
    fireEvent.click(screen.getByText('buy-now'));
    fireEvent.click(screen.getByText('cart-clear'));
    expect(cart()).toHaveLength(0);
    expect(buyNow()).toMatchObject({ id: 'p-1', quantity: 1 });
  });

  it('cart quantity edits do not affect the Buy Now item', () => {
    renderHarness();
    fireEvent.click(screen.getByText('add-cart'));
    fireEvent.click(screen.getByText('buy-now'));
    fireEvent.click(screen.getByText('cart-qty-9'));
    expect(cart()[0].quantity).toBe(9);
    expect(buyNow()).toMatchObject({ quantity: 1 });
  });

  it('persists the Buy Now item across reloads (same tab)', () => {
    const { unmount } = renderHarness();
    fireEvent.click(screen.getByText('buy-now'));
    unmount();
    renderHarness();
    expect(buyNow()).toMatchObject({ id: 'p-1', quantity: 1 });
    expect(cart()).toHaveLength(0);
  });

  it('refuses Buy Now for out-of-stock products', () => {
    render(
      <CartProvider>
        <BuyNowOos />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText('buy-now-oos'));
    expect(JSON.parse(screen.getByTestId('buynow2').textContent || 'null')).toBeNull();
  });
});

function BuyNowOos() {
  const { startBuyNow, buyNowItem } = useCart();
  return (
    <div>
      <div data-testid="buynow2">{JSON.stringify(buyNowItem)}</div>
      <button
        onClick={() => startBuyNow(item({ stock: 0 }))}
      >
        buy-now-oos
      </button>
    </div>
  );
}
