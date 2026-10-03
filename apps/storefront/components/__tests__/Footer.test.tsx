import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, screen, act } from '@testing-library/react';
import { StorefrontConfigProvider } from '@/context/StorefrontConfigContext';
import type { StorefrontConfig } from '@/lib/api/storefront-config';
import Footer from '../Footer';

vi.mock('next/navigation', () => ({ usePathname: () => '/orders' }));
vi.mock('../StoreBrand', () => ({ StoreBrand: () => <span>brand</span> }));
vi.mock('../EcoMateAttribution', () => ({
  default: () => <span>attribution</span>,
}));

const CONFIG = {
  store: { name: 'Test Store', phone: '01700000000' },
  social: {},
  footer: {},
  menu: {},
} as unknown as StorefrontConfig;

const setUserAgent = (ua: string) => {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: ua,
    configurable: true,
  });
};

/**
 * The mobile-download row used to resolve navigator.userAgent while rendering.
 * The server has no navigator, so it emitted the "open on your phone" hint
 * while an Android phone emitted a Google Play anchor on its first render.
 * React discarded the server tree and Next.js surfaced the mismatch as a
 * hydration overlay. These tests pin the fix: the very first client render must
 * match the server's HTML exactly, and the platform-specific link may only
 * appear afterwards.
 */
describe('Footer hydration safety', () => {
  const ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
  const originalUA = window.navigator.userAgent;

  beforeEach(() => {
    setUserAgent(ANDROID_UA);
  });

  afterEach(() => {
    setUserAgent(originalUA);
  });

  const renderFooter = () =>
    render(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <Footer />
      </StorefrontConfigProvider>,
    );

  it('server renders no platform-specific store link', () => {
    const html = renderToString(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <Footer />
      </StorefrontConfigProvider>,
    );

    expect(html).not.toContain('/mobile-download/storefront/android');
    expect(html).not.toContain('/mobile-download/storefront/ios');
    // The placeholder both sides render identically before mount.
    expect(html).toContain('Open on your phone to install the app');
  });

  it('never reads the user agent during render', () => {
    // The bug is a render-time branch on navigator, not a wrong value. So the
    // read itself is trapped: if the component touches navigator while
    // rendering, this throws and the test fails, whatever the user agent says.
    // The effect is excluded by construction — it does not run under
    // renderToString, which is exactly the boundary being asserted.
    const realNavigator = window.navigator;
    Object.defineProperty(window, 'navigator', {
      value: new Proxy(
        {},
        {
          get() {
            throw new Error('navigator read during render');
          },
        },
      ),
      configurable: true,
    });

    try {
      expect(() =>
        renderToString(
          <StorefrontConfigProvider initialConfig={CONFIG}>
            <Footer />
          </StorefrontConfigProvider>,
        ),
      ).not.toThrow();
    } finally {
      Object.defineProperty(window, 'navigator', {
        value: realNavigator,
        configurable: true,
      });
    }
  });

  it('renders the Android store link, not the desktop hint, after mount', async () => {
    renderFooter();
    await act(async () => {});

    expect(screen.getByText('Get it on')).toBeTruthy();
    const link = screen.getByText('Get it on').closest('a');
    expect(link?.getAttribute('href')).toContain('/mobile-download/storefront/android');
    // The placeholder is replaced, so it cannot be left behind as a duplicate.
    expect(screen.queryByText('Open on your phone to install the app')).toBeNull();
  });

  it('keeps the generic hint on desktop', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36');
    renderFooter();

    await act(async () => {});
    expect(screen.getByText('Open on your phone to install the app')).toBeTruthy();
    expect(screen.queryByText('Get it on')).toBeNull();
  });

  it('links the iOS store after mount on an iPhone', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1');
    renderFooter();

    await act(async () => {});
    const link = screen.getByText('Get it on').closest('a');
    expect(link?.getAttribute('href')).toContain('/mobile-download/storefront/ios');
  });

  it('prefers an admin-configured store URL over the platform fallback', async () => {
    const config = {
      ...CONFIG,
      playStoreUrl: 'https://play.google.com/store/apps/details?id=ecomate',
    } as unknown as StorefrontConfig;

    render(
      <StorefrontConfigProvider initialConfig={config}>
        <Footer />
      </StorefrontConfigProvider>,
    );

    // Configured explicitly, so it renders on the server too — no divergence.
    expect(screen.getByText('Download on')).toBeTruthy();

    await act(async () => {});
    expect(screen.getByText('Download on')).toBeTruthy();
    expect(screen.queryByText('Get it on')).toBeNull();
  });
});