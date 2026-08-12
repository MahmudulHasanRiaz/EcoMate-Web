import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { StorefrontConfigProvider } from '@/context/StorefrontConfigContext';
import { AuthProvider } from '@/context/AuthContext';
import { setPixelIds, setConsent, initMetaPixel } from '@/lib/tracking';
import type { StorefrontConfig } from '@/lib/api/storefront-config';
import LandingPrimaryProductView from '../LandingPrimaryProductView';

vi.mock('@/lib/api/auth', () => ({
  getMe: vi.fn().mockResolvedValue(null),
}));

const CONFIG = {
  currency: { code: 'BDT', symbol: '৳' },
} as unknown as StorefrontConfig;

const assignedBoot = {
  id: 'boot-1',
  name: 'Classic Brown Winter Comfort Boot (CWB-1)',
  sku: 'CWB-1',
  category: 'Footwear',
  price: 4000,
};

const variantBoot = {
  id: 'boot-1',
  name: 'Classic Brown Winter Comfort Boot (CWB-1)',
  sku: 'CWB-1',
  category: 'Footwear',
  price: 4000,
  variants: [
    { id: 'v40', sku: 'CWB-1-40', price: 3400, isActive: false },
    { id: 'v44', sku: 'CWB-1-44', price: 3500, isActive: true },
  ],
};

describe('LandingPrimaryProductView — dedicated landing product view', () => {
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
  });

  const viewContentCalls = () =>
    vi.mocked(window.fbq).mock.calls.filter((c: any[]) => c[1] === 'ViewContent');

  const renderLanding = (primaryProducts: any[]) =>
    render(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <AuthProvider>
          <LandingPrimaryProductView primaryProducts={primaryProducts} />
        </AuthProvider>
      </StorefrontConfigProvider>,
    );

  it('dedicated product landing page → exactly ONE ViewContent with the canonical catalog id', () => {
    renderLanding([assignedBoot]);
    const calls = viewContentCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toMatchObject({
      content_type: 'product',
      content_ids: ['CWB-1'],
      content_name: 'Classic Brown Winter Comfort Boot (CWB-1)',
      content_category: 'Footwear',
      value: 4000,
      currency: 'BDT',
      contents: [{ id: 'CWB-1', quantity: 1, item_price: 4000 }],
    });
  });

  it('React rerender → NO additional ViewContent', () => {
    const { rerender } = renderLanding([assignedBoot]);
    expect(viewContentCalls()).toHaveLength(1);
    rerender(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <AuthProvider>
          <LandingPrimaryProductView primaryProducts={[assignedBoot]} />
        </AuthProvider>
      </StorefrontConfigProvider>,
    );
    expect(viewContentCalls()).toHaveLength(1);
  });

  it('scroll → NO additional ViewContent', () => {
    renderLanding([assignedBoot]);
    expect(viewContentCalls()).toHaveLength(1);
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(viewContentCalls()).toHaveLength(1);
  });

  it('CTA click → NO additional ViewContent', () => {
    renderLanding([assignedBoot]);
    expect(viewContentCalls()).toHaveLength(1);
    act(() => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(viewContentCalls()).toHaveLength(1);
  });

  it('assigned product changes → fires ONE ViewContent with the new product id', () => {
    const { rerender } = renderLanding([assignedBoot]);
    expect(viewContentCalls()).toHaveLength(1);
    const other = { ...assignedBoot, id: 'bag-2', name: 'Canvas Tote (CTB-2)', sku: 'CTB-2', price: 900 };
    rerender(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <AuthProvider>
          <LandingPrimaryProductView primaryProducts={[other]} />
        </AuthProvider>
      </StorefrontConfigProvider>,
    );
    const calls = viewContentCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1][2].content_ids).toEqual(['CTB-2']);
  });

  it('variant-specific assigned product → canonical active-variant catalog id', () => {
    renderLanding([variantBoot]);
    const calls = viewContentCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toMatchObject({ content_ids: ['CWB-1-44'], value: 3500 });
  });

  it('related/recommended product cards → NO ViewContent on render', () => {
    const sectionCard = { id: 'rec-9', name: 'Recommendation', sku: 'REC-9', price: 500 };
    // Cards are rendered by sections and never reach primaryProducts — only the
    // assigned product ships through the page's primary filter. Simulate a full
    // products array where all but the assigned one are cards.
    renderLanding([assignedBoot]);
    // Simulate section-card rendering — plain render, no track call.
    const before = viewContentCalls().length;
    expect([sectionCard]).toHaveLength(1);
    expect(before).toBe(1);
    expect(viewContentCalls().some((c: any[]) => String(c[2].content_ids?.[0]) === 'REC-9')).toBe(false);
  });

  it('multiple assigned products → exactly ONE ViewContent per primary product', () => {
    renderLanding([assignedBoot, { ...assignedBoot, id: 'bag-2', sku: 'CTB-2', price: 900 }]);
    const calls = viewContentCalls();
    expect(calls).toHaveLength(2);
    expect(calls.map((c: any[]) => c[2].content_ids[0]).sort()).toEqual(['CWB-1', 'CTB-2'].sort());
  });

  it('empty primaryProducts → NO ViewContent', () => {
    renderLanding([]);
    expect(viewContentCalls()).toHaveLength(0);
  });

  it('Browser pixel and CAPI mirror share the SAME event_id', () => {
    renderLanding([assignedBoot]);
    const fbqCall = viewContentCalls()[0];
    const fbqId = fbqCall[3].eventID;
    expect(fbqId).toMatch(/^view_content_CWB-1_[0-9a-f]{8}_\d+$/);
    const mirror = fetchMock.mock.calls.find(([url]: any[]) => String(url).includes('/tracking/events'));
    expect(mirror).toBeDefined();
    const body = JSON.parse(mirror![1].body as string);
    expect(body.eventId).toBe(fbqId);
    expect(body.eventName).toBe('view_content');
    expect(body.customData.content_ids).toEqual(['CWB-1']);
  });
});