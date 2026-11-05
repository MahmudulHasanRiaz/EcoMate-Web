import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StickyBar } from '../StickyBar';

const isInert = (el: HTMLElement) =>
  el.hasAttribute('inert') || (el as unknown as { inert?: boolean }).inert === true;

describe('StickyBar', () => {
  it('keeps the hidden bar out of the tab order and accessibility tree (inert, not aria-hidden)', () => {
    render(<StickyBar isOutOfStock={false} visible={false} onOpenSheet={vi.fn()} />);
    const bar = screen.getByTestId('sticky-bar');

    // Hidden: inert, and NOT aria-hidden — aria-hidden over the bar's
    // focusable buttons is the Lighthouse agentic-browsing failure
    // ("Accessibility tree is not well-formed", PSI 2026-11-05).
    expect(isInert(bar)).toBe(true);
    expect(bar.hasAttribute('aria-hidden')).toBe(false);
    // The buttons are still rendered (the bar slides, it does not
    // mount/unmount) — inert is what makes them unreachable.
    expect(screen.getByText('ADD TO CART')).toBeTruthy();
    expect(screen.getByText('ORDER NOW')).toBeTruthy();
  });

  it('is fully interactive while visible', () => {
    const onOpenSheet = vi.fn();
    render(<StickyBar isOutOfStock={false} visible onOpenSheet={onOpenSheet} />);
    const bar = screen.getByTestId('sticky-bar');

    expect(isInert(bar)).toBe(false);
    screen.getByText('ADD TO CART').click();
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
  });

  it('renders the out-of-stock state inert while hidden too', () => {
    render(<StickyBar isOutOfStock visible={false} onOpenSheet={vi.fn()} />);
    const bar = screen.getByTestId('sticky-bar');

    expect(isInert(bar)).toBe(true);
    expect(screen.getByText('Out of Stock')).toBeTruthy();
  });
});
