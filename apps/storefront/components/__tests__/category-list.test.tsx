import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CategoryList from '../CategoryList';
import { getMenuCategories } from '@/lib/api/products';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/api/products', () => ({
  getMenuCategories: vi.fn(),
}));

const mockedCats = vi.mocked(getMenuCategories);

describe('CategoryList centering (category-name-center)', () => {
  beforeEach(() => {
    // jsdom lacks ResizeObserver (used for scroll-dim caching)
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it('centers every name under its image: card is a centered flex column, not inline-block', async () => {
    mockedCats.mockResolvedValue([
      { id: 'c1', name: 'Wallet', slug: 'wallet', image: '/w.jpg' },
      { id: 'c2', name: 'Sandals', slug: 'sandals', image: '/s.jpg' },
      // long name: stretches the card — image must still share its axis
      { id: 'c3', name: 'Very Long Category Name Here', slug: 'long', image: '/l.jpg' },
    ] as any);

    render(<CategoryList />);

    await waitFor(() => expect(screen.getByTitle('Wallet')).toBeInTheDocument());
    const cards = screen
      .getAllByTitle(/Wallet|Sandals|Very Long/)
      .map((nameEl) => nameEl.closest('a')!);

    expect(cards).toHaveLength(3);
    for (const card of cards) {
      // `flex` must win: `inline-block` later in the cascade kills
      // items-center and left-aligns the fixed-width image box.
      expect(card.classList.contains('flex')).toBe(true);
      expect(card.classList.contains('flex-col')).toBe(true);
      expect(card.classList.contains('items-center')).toBe(true);
      expect(card.classList.contains('inline-block')).toBe(false);
    }
    // name itself spans full width, centered
    for (const nameEl of screen.getAllByTitle(/Wallet|Sandals|Very Long/)) {
      expect(nameEl.classList.contains('text-center')).toBe(true);
      expect(nameEl.classList.contains('block')).toBe(true);
      expect(nameEl.classList.contains('w-full')).toBe(true);
    }
  });
});
