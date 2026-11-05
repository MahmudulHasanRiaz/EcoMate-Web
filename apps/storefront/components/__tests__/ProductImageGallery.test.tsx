import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ProductImageGallery } from '../ProductImageGallery';

/**
 * P6 — PDP gallery autoplay main-thread behavior.
 * Pre-fix: the rAF loop ran (and setState-rendered the whole gallery every
 * frame) even with the tab hidden or the gallery scrolled off-screen, and
 * progress was a React state updated on every animation frame.
 */
describe('ProductImageGallery autoplay (P6)', () => {
  let rafCallback: FrameRequestCallback | null;
  let cancelSpy: ReturnType<typeof vi.spyOn>;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let nowSpy: ReturnType<typeof vi.spyOn>;
  let nowValue: number;

  beforeEach(() => {
    rafCallback = null;
    nowValue = 1_000;
    rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        rafCallback = cb;
        return 42;
      });
    cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowValue);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  afterEach(() => {
    rafSpy.mockRestore();
    cancelSpy.mockRestore();
    nowSpy.mockRestore();
  });

  const renderGallery = () =>
    render(
      <ProductImageGallery
        images={['/uploads/a.jpg', '/uploads/b.jpg']}
        productName="Gallery Product"
      />,
    );

  it('schedules the autoplay rAF loop while visible', () => {
    renderGallery();
    expect(rafSpy).toHaveBeenCalled();
    expect(rafCallback).not.toBeNull();
  });

  it('advances the progress bar through the DOM (half-way at 2s of 4s)', () => {
    const { container } = renderGallery();
    nowValue = 3_000; // 2000ms elapsed of AUTO_SLIDE_MS=4000
    act(() => {
      rafCallback?.(performance.now());
    });
    const bar = container.querySelector('[data-testid="gallery-progress-bar"]') as HTMLElement | null;
    expect(bar).not.toBeNull();
    expect(bar?.style.width).toBe('50%');
  });

  it('cancels the rAF loop when the tab becomes hidden', () => {
    renderGallery();
    cancelSpy.mockClear();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('cancels the rAF loop when the gallery scrolls out of view', () => {
    renderGallery();
    cancelSpy.mockClear();
    const observers = (globalThis as any).IntersectionObserver.instances as Array<{
      trigger: (b: boolean) => void;
    }>;
    expect(observers.length).toBeGreaterThan(0);
    for (const o of observers) act(() => o.trigger(false));
    expect(cancelSpy).toHaveBeenCalled();
  });
});

/**
 * Hero priority (PLP/PDP scale round) — the first gallery image is the
 * PDP LCP element on BOTH viewports: desktop slide 1 and mobile slide 1
 * carry priority treatment (fetchpriority=high, never lazy). Everything
 * else — later slides, thumbnails — stays unprioritised so the priority
 * budget remains the hero only.
 */
describe('ProductImageGallery hero priority (scale round)', () => {
  const renderGallery = () =>
    render(
      <ProductImageGallery
        images={['/uploads/a.jpg', '/uploads/b.jpg']}
        productName="Gallery Product"
      />,
    );

  it('prioritises ONLY the first slide in both carousels', () => {
    const { container } = renderGallery();
    const byAlt = (alt: string) =>
      container.querySelector(`img[alt="${alt}"]`) as HTMLImageElement | null;

    const desktopHero = byAlt('Gallery Product 1');
    const mobileHero = byAlt('Gallery Product image 1');
    expect(desktopHero).not.toBeNull();
    expect(mobileHero).not.toBeNull();
    for (const hero of [desktopHero, mobileHero]) {
      expect(hero?.getAttribute('fetchpriority')).toBe('high');
      // Never lazy: next/image omits the loading attribute entirely on
      // priority images (the preload IS the eager load), so the check
      // is "not lazy", not a literal loading="eager".
      expect(hero?.getAttribute('loading')).not.toBe('lazy');
    }

    const desktopSecond = byAlt('Gallery Product 2');
    const mobileSecond = byAlt('Gallery Product image 2');
    for (const slide of [desktopSecond, mobileSecond]) {
      expect(slide).not.toBeNull();
      expect(slide?.getAttribute('fetchpriority')).not.toBe('high');
      expect(slide?.getAttribute('loading')).toBe('lazy');
    }

    // Thumbnails (alt="") never take priority budget.
    const thumbs = Array.from(container.querySelectorAll('img[alt=""]'));
    expect(thumbs.length).toBeGreaterThan(0);
    for (const t of thumbs) {
      expect(t.getAttribute('fetchpriority')).not.toBe('high');
    }
  });
});
