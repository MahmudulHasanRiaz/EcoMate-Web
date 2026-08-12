import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import LandingPage from '@/app/(landing)/landing/[slug]/page';
import { serverFetch } from '@/lib/api-server';
import { getStorefrontConfigServer } from '@/lib/api/storefront-config-server';
import { StorefrontConfigProvider } from '@/context/StorefrontConfigContext';
import { AuthProvider } from '@/context/AuthContext';
import { setPixelIds, setConsent, initMetaPixel } from '@/lib/tracking';
import type { StorefrontConfig } from '@/lib/api/storefront-config';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/api-server', () => ({ serverFetch: vi.fn() }));
vi.mock('@/lib/api/storefront-config-server', () => ({ getStorefrontConfigServer: vi.fn() }));
vi.mock('@/components/landing/TemplateRenderer', () => ({ default: () => null }));
vi.mock('@/components/landing/CustomRenderer', () => ({ default: () => null }));
vi.mock('@/lib/api/auth', () => ({
  getMe: vi.fn().mockResolvedValue(null),
}));

const mockServerFetch = serverFetch as unknown as ReturnType<typeof vi.fn>;
const mockGetConfig = getStorefrontConfigServer as unknown as ReturnType<typeof vi.fn>;

const CONFIG = { currency: { code: 'BDT', symbol: '৳' } } as unknown as StorefrontConfig;

const assignedBoot = {
  id: 'boot-1',
  name: 'Classic Brown Winter Comfort Boot (CWB-1)',
  sku: 'CWB-1',
  category: 'Footwear',
  price: 4000,
};
const sectionCard = { id: 'rec-9', name: 'Recommendation', sku: 'REC-9', price: 500 };

const landingData = (overrides: Record<string, unknown> = {}) => ({
  id: 'lp-1',
  title: 'Winter Sale',
  slug: 'winter-sale',
  pageType: 'template',
  templateId: null,
  sections: [{ productId: 'rec-9' }],
  customHtml: null,
  customCss: null,
  productIds: ['boot-1'],
  comboIds: [],
  trackingJson: {},
  ...overrides,
});

describe('landing page — dedicated primary product ViewContent wiring', () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    document.cookie = '_fbp=fb.1.1.1; path=/';
    document.cookie = '_fbc=fb.1.2.3; path=/';
    document.cookie = 'ecomate_tracking_optout=; Max-Age=0; path=/';
    setConsent(false, true);

    window.fbq = vi.fn();
    window.ttq = { track: vi.fn(), page: vi.fn() };
    setPixelIds('TEST-META-ID', 'TEST-TIKTOK-CODE');
    initMetaPixel();
    vi.mocked(window.fbq).mockClear();

    fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);

    mockServerFetch.mockReset();
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue(CONFIG);
  });

  const viewContentCalls = () =>
    vi.mocked(window.fbq).mock.calls.filter((c: any[]) => c[1] === 'ViewContent');

  const mockLandingRoutes = (page: Record<string, unknown>) => {
    mockServerFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/landing-pages/published/') || path.startsWith('/landing-pages/preview/')) return page;
      if (path.startsWith('/products?ids=')) return { data: [assignedBoot, sectionCard] };
      return null;
    });
  };

  const renderPage = async (searchParams: Record<string, string> = {}) => {
    const tree = await LandingPage({
      params: Promise.resolve({ slug: 'winter-sale' }),
      searchParams: Promise.resolve(searchParams),
    });
    return render(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <AuthProvider>{tree}</AuthProvider>
      </StorefrontConfigProvider>,
    );
  };

  it('dedicated product landing page → exactly ONE ViewContent for the assigned product', async () => {
    mockLandingRoutes(landingData());
    await renderPage();
    const calls = viewContentCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toMatchObject({
      content_ids: ['CWB-1'],
      content_type: 'product',
      value: 4000,
      currency: 'BDT',
    });
  });

  it('section/recommended product cards on the page → NO ViewContent', async () => {
    mockLandingRoutes(landingData());
    await renderPage();
    const calls = viewContentCalls();
    expect(calls).toHaveLength(1);
    expect(calls.some((c: any[]) => String(c[2].content_ids?.[0]) === 'REC-9')).toBe(false);
  });

  it('preview mode → NO ViewContent', async () => {
    mockLandingRoutes(landingData());
    await renderPage({ preview: 'true' });
    expect(viewContentCalls()).toHaveLength(0);
  });

  it('page without assigned products → NO ViewContent even with section cards', async () => {
    mockLandingRoutes(landingData({ productIds: [] }));
    await renderPage();
    expect(viewContentCalls()).toHaveLength(0);
  });
});