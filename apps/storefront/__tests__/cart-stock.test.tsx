import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { CartProvider, useCart } from '../context/CartContext';
import type { CartItem } from '../lib/types';

function Harness({ add, bump }: { add: CartItem; bump?: { id: string; qty: number } }) {
  const { addToCart, updateQuantity, cartCount, cartTotal, items } = useCart();
  const [added, setAdded] = useState(false);
  return (
    <div>
      <div data-testid="count">{cartCount}</div>
      <div data-testid="total">{cartTotal}</div>
      <div data-testid="items">{JSON.stringify(items)}</div>
      <button
        onClick={() => {
          addToCart(add);
          setAdded(true);
        }}
      >
        add
      </button>
      <button data-testid="added">{String(added)}</button>
      {bump && (
        <button data-testid="bump" onClick={() => updateQuantity(bump.id, bump.qty)}>
          bump
        </button>
      )}
    </div>
  );
}

function renderCart(add: CartItem, bump?: { id: string; qty: number }) {
  return render(
    <CartProvider>
      <Harness add={add} bump={bump} />
    </CartProvider>,
  );
}

function lineItems(): CartItem[] {
  return JSON.parse(screen.getByTestId('items').textContent || '[]');
}

describe('CartContext zero/negative stock gating', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not add a product with zero stock', () => {
    renderCart({
      id: 'p-1',
      name: 'Zero Stock',
      price: 100,
      image: '',
      quantity: 1,
      stock: 0,
      availabilityMode: 'MANAGED_STOCK',
    });
    fireEvent.click(screen.getByText('add'));
    expect(lineItems()).toHaveLength(0);
  });

  it('does not add a product with negative stock', () => {
    renderCart({
      id: 'p-2',
      name: 'Negative Stock',
      price: 100,
      image: '',
      quantity: 1,
      stock: -3,
      availabilityMode: 'INVENTORY_CONTROLLED',
    });
    fireEvent.click(screen.getByText('add'));
    expect(lineItems()).toHaveLength(0);
  });

  it('adds a product with undefined stock (ALWAYS_IN_STOCK) at requested quantity', () => {
    renderCart({
      id: 'p-3',
      name: 'Unlimited',
      price: 50,
      image: '',
      quantity: 3,
      availabilityMode: 'ALWAYS_IN_STOCK',
    });
    fireEvent.click(screen.getByText('add'));
    const items = lineItems();
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });

  it('caps add quantity at positive stock', () => {
    renderCart({
      id: 'p-4',
      name: 'Capped',
      price: 50,
      image: '',
      quantity: 5,
      stock: 2,
      availabilityMode: 'MANAGED_STOCK',
    });
    fireEvent.click(screen.getByText('add'));
    expect(lineItems()[0].quantity).toBe(2);
  });

  it('leaves an existing cart item untouched when its stock drops to zero', () => {
    localStorage.setItem(
      'ecomate_cart',
      JSON.stringify([
        {
          id: 'p-5',
          name: 'Sells Out',
          price: 50,
          image: '',
          quantity: 2,
          stock: 0,
          availabilityMode: 'MANAGED_STOCK',
        },
      ]),
    );
    renderCart(
      {
        id: 'p-5',
        name: 'Sells Out',
        price: 50,
        image: '',
        quantity: 1,
        stock: 0,
        availabilityMode: 'MANAGED_STOCK',
      },
      { id: 'p-5', qty: 4 },
    );
    fireEvent.click(screen.getByTestId('bump'));
    const items = lineItems();
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
  });

  it('never caps an existing cart item to a negative quantity', () => {
    localStorage.setItem(
      'ecomate_cart',
      JSON.stringify([
        {
          id: 'p-6',
          name: 'Drops Negative',
          price: 50,
          image: '',
          quantity: 2,
          stock: -1,
          availabilityMode: 'INVENTORY_CONTROLLED',
        },
      ]),
    );
    renderCart(
      {
        id: 'p-6',
        name: 'Drops Negative',
        price: 50,
        image: '',
        quantity: 1,
        stock: -1,
        availabilityMode: 'INVENTORY_CONTROLLED',
      },
      { id: 'p-6', qty: 4 },
    );
    fireEvent.click(screen.getByTestId('bump'));
    const items = lineItems();
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
  });
});