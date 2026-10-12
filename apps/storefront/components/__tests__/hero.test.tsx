import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Hero from '../Hero';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const slides = [{ image: '/main.jpg', alt: 'Main' }];

describe('Hero secondary banner (no gap below)', () => {
  it('fills the grid row instead of a shorter fixed-aspect box', () => {
    const { container } = render(<Hero slides={slides} secondaryBanner="/sec.jpg" secondaryBannerAlt="Secondary" />);

    const secImg = screen.getByAltText('Secondary');
    // walk up: img -> fill wrapper -> column
    const wrapper = secImg.parentElement!;
    const column = wrapper.parentElement!;

    // the image box must stretch to the row height (flex-1), never a
    // fixed aspect shorter than the main banner (gap math: internal grid
    // gaps make 5/4 shorter than the main 5/2 column by ~6px)
    expect(wrapper.className).not.toMatch(/aspect-\[/);
    expect(wrapper.classList.contains('flex-1')).toBe(true);
    expect(column.className).toMatch(/flex-col/);
    // image still covers whatever height results
    expect(secImg.className).toMatch(/object-cover/);
    expect(container.querySelector('.aspect-\\[5\\/4\\]')).toBeNull();
  });

  it('renders nothing extra when no secondary banner is configured', () => {
    render(<Hero slides={slides} />);
    expect(screen.queryByAltText('Secondary')).toBeNull();
  });
});
