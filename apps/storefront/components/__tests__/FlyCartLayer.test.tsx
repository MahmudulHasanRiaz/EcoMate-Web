import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import FlyCartLayer from '../FlyCartLayer';

describe('FlyCartLayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="floating-cart" class="translate-x-0"></div>';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('never writes translate utilities onto #floating-cart (its translate is owned by Tailwind)', async () => {
    render(<FlyCartLayer />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('fly-to-cart', { detail: { x: 10, y: 10, image: '/img.jpg' } }),
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    const cart = document.getElementById('floating-cart')!;
    expect(cart.classList.contains('-translate-x-2')).toBe(false);
    expect(cart.classList.contains('translate-x-0')).toBe(true);
  });

  it('removes the flying item once the flight completes', async () => {
    render(<FlyCartLayer />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('fly-to-cart', { detail: { x: 10, y: 10, image: '/img.jpg' } }),
      );
    });
    expect(screen.getByAltText('Flying Item')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.queryByAltText('Flying Item')).toBeNull();
  });
});
