import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StorefrontConfigProvider } from '@/context/StorefrontConfigContext';
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { WishlistProvider } from '@/context/WishlistContext';
import { setPixelIds, setConsent, initMetaPixel } from '@/lib/tracking';
import type { StorefrontConfig } from '@/lib/api/storefront-config';
import ProductDetailClient from '../ProductDetailClient';

const { pushMock, apiClientGetMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  apiClientGetMock: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/api-client', () => ({
  default: { get: apiClientGetMock },
}));
vi.mock('@/lib/api/auth', () => ({ getMe: vi.fn().mockResolvedValue(null) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const CONFIG = {
  currency: { code: 'BDT', symbol: '৳' },
  features: { sizeChart: false, showReviews: true },
  delivery: { freeDeliveryMin: 0 },
  order: { whatsapp: '', callNumber: '' },
  social: { whatsapp: '' },
  store: { phone: '' },
} as unknown as StorefrontConfig;

const attr = (name: string, value: string) => ({
  attributeValue: { attribute: { name }, value },
});

const simpleProduct = {
  id: 'p-simple',
  slug: 'simple-toy',
  sku: 'TOY-1',
  name: 'Simple Toy',
  type: 'simple',
  category: 'Toys',
  price: 500,
  basePrice: 500,
  salePrice: 450,
  currency: 'BDT',
  codAvailable: true,
  images: [],
  description: 'A simple product',
  shortDesc: 'A simple product',
  variants: [],
  stock: 10,
  attributeValues: [],
} as any;

const variantProduct = {
  id: 'p-var',
  slug: 'classic-boot',
  sku: 'CWB-1',
  name: 'Classic Boot',
  type: 'variable',
  category: 'Footwear',
  price: 4000,
  basePrice: 4000,
  salePrice: 3800,
  currency: 'BDT',
  codAvailable: true,
  images: [],
  description: 'A variable product',
  shortDesc: 'A variable product',
  stock: 10,
  variants: [
    {
      id: 'v44',
      sku: 'CWB-1-44',
      name: 'Classic Boot - 44',
      price: 3400,
      salePrice: 3400,
      isActive: true,
      stock: 5,
      images: [],
      attributeValues: [attr('Size', '44')],
    },
    {
      id: 'v46',
      sku: 'CWB-1-46',
      name: 'Classic Boot - 46',
      price: 3600,
      salePrice: 3600,
      isActive: true,
      stock: 4,
      images: [],
      attributeValues: [attr('Size', '46')],
    },
  ],
} as any;

describe('ProductDetailClient — ViewContent strict semantics', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

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
    apiClientGetMock.mockClear();
    apiClientGetMock.mockResolvedValue({ data: [] });
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
    if (fetchSpy.mockRestore) void fetchSpy;
  });

  const renderDetail = (product: any) =>
    render(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <AuthProvider>
          <CartProvider>
            <WishlistProvider>
              <ProductDetailClient product={product} />
            </WishlistProvider>
          </CartProvider>
        </AuthProvider>
      </StorefrontConfigProvider>,
    );

  const viewContentCalls = () => vi.mocked(window.fbq).mock.calls.filter((c: any[]) => c[1] === 'ViewContent');
  const viewContentMirrors = () =>
    fetchSpy.mock.calls.filter((c: any[]) => {
      try {
        const body = JSON.parse(String((c[1] as any)?.body));
        return body.eventName === 'view_content';
      } catch {
        return false;
      }
    });

  it('simple product first genuine view → exactly ONE ViewContent with the canonical catalog id', async () => {
    renderDetail(simpleProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    expect(viewContentCalls()[0][2]).toMatchObject({
      content_type: 'product',
      content_ids: ['TOY-1'],
      content_name: 'Simple Toy',
      content_category: 'Toys',
      value: 500,
      currency: 'BDT',
    });
    expect(viewContentMirrors()).toHaveLength(1);
  });

  it('React rerender → NO additional ViewContent', async () => {
    const { rerender } = renderDetail(simpleProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    rerender(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <AuthProvider>
          <CartProvider>
            <WishlistProvider>
              <ProductDetailClient product={simpleProduct} />
            </WishlistProvider>
          </CartProvider>
        </AuthProvider>
      </StorefrontConfigProvider>,
    );
    expect(viewContentCalls()).toHaveLength(1);
  });

  it('scroll → NO additional ViewContent', async () => {
    renderDetail(simpleProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    fireEvent.scroll(window, { target: { scrollY: 500 } });
    fireEvent.scroll(window, { target: { scrollY: 1000 } });
    expect(viewContentCalls()).toHaveLength(1);
  });

  it('CTA click (add to cart) → NO additional ViewContent (AddToCart fires instead)', async () => {
    renderDetail(simpleProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /ADD TO CART/i }));
    expect(viewContentCalls()).toHaveLength(1);
    const atc = vi.mocked(window.fbq).mock.calls.filter((c: any[]) => c[1] === 'AddToCart');
    expect(atc).toHaveLength(1);
  });

  it('quantity/state update → NO additional ViewContent', async () => {
    renderDetail(simpleProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    const plus = screen.getAllByRole('button').find((b) => b.querySelector('svg[class*="lucide-plus"]'));
    expect(plus).toBeTruthy();
    fireEvent.click(plus!);
    fireEvent.click(plus!);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
  });

  it('variable product fires IMMEDIATELY on open with the PARENT catalog id (no variant wait)', async () => {
    renderDetail(variantProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    // Parent product identity — never a variant id, even though the catalog's
    // variant items exist. Variant matching belongs to AddToCart/Purchase.
    expect(viewContentCalls()[0][2]).toMatchObject({
      content_type: 'product',
      content_ids: ['CWB-1'],
      content_name: 'Classic Boot',
      content_category: 'Footwear',
      value: 4000,
      currency: 'BDT',
    });
    expect(viewContentMirrors()).toHaveLength(1);
  });

  it('variant switch 44 → 46 → NO new ViewContent (same page view)', async () => {
    renderDetail(variantProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    expect(viewContentCalls()[0][2].content_ids).toEqual(['CWB-1']);
    fireEvent.click(screen.getByRole('button', { name: '46' }));
    // allow any misbehaving effect to flush — count must stay exactly 1
    await new Promise((r) => setTimeout(r, 50));
    expect(viewContentCalls()).toHaveLength(1);
    expect(viewContentMirrors()).toHaveLength(1);
  });

  it('variant re-selection A → B → A → NO additional ViewContent', async () => {
    renderDetail(variantProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '44' }));
    fireEvent.click(screen.getByRole('button', { name: '46' }));
    fireEvent.click(screen.getByRole('button', { name: '44' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(viewContentCalls()).toHaveLength(1);
  });

  it('client navigation variable A → variable B WITHOUT remount → 2 distinct events', async () => {
    // Next.js reuses the page component across same-route param changes, so
    // the trigger must key on product.id — not on mount alone.
    const otherVariable = { ...variantProduct, id: 'p-var-2', sku: 'CWB-2', name: 'Classic Boot V2' };
    const view = renderDetail(variantProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    expect(viewContentCalls()[0][2].content_ids).toEqual(['CWB-1']);
    view.rerender(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <AuthProvider>
          <CartProvider>
            <WishlistProvider>
              <ProductDetailClient product={otherVariable} />
            </WishlistProvider>
          </CartProvider>
        </AuthProvider>
      </StorefrontConfigProvider>,
    );
    await waitFor(() => expect(viewContentCalls()).toHaveLength(2));
    expect(viewContentCalls()[1][2].content_ids).toEqual(['CWB-2']);
    const ids = viewContentCalls().map((c: any[]) => c[3].eventID as string);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it('same-product prop update (price change) → NO new ViewContent', async () => {
    const view = renderDetail(variantProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    view.rerender(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <AuthProvider>
          <CartProvider>
            <WishlistProvider>
              <ProductDetailClient product={{ ...variantProduct, price: 4500 }} />
            </WishlistProvider>
          </CartProvider>
        </AuthProvider>
      </StorefrontConfigProvider>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(viewContentCalls()).toHaveLength(1);
  });

  it('variable PDP browser + CAPI share one event_id (dedup pair)', async () => {
    renderDetail(variantProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    await waitFor(() => expect(viewContentMirrors()).toHaveLength(1));
    const browserId = viewContentCalls()[0][3].eventID as string;
    const mirrorBody = JSON.parse(String(viewContentMirrors()[0][1]?.body));
    expect(mirrorBody.eventId).toBe(browserId);
    expect(mirrorBody.eventName).toBe('view_content');
    // Mirror customData parity: parent identity, single quantity-1 row.
    expect(mirrorBody.customData).toMatchObject({
      content_type: 'product',
      content_ids: ['CWB-1'],
      contents: [{ id: 'CWB-1', quantity: 1, item_price: 4000 }],
    });
    // TikTok pixel receives the translated shape exactly once (no double fire).
    const tiktokVC = vi.mocked(window.ttq.track).mock.calls.filter((c: any[]) => c[0] === 'ViewContent');
    expect(tiktokVC).toHaveLength(1);
    expect(tiktokVC[0][1]).toMatchObject({
      content_type: 'product',
      contents: [{ content_id: 'CWB-1', quantity: 1, price: 4000 }],
    });
    expect(tiktokVC[0][1]).not.toHaveProperty('content_ids');
  });

  it('StrictMode double-mount → still ONE ViewContent (ref guard survives)', async () => {
    render(
      <React.StrictMode>
        <StorefrontConfigProvider initialConfig={CONFIG}>
          <AuthProvider>
            <CartProvider>
              <WishlistProvider>
                <ProductDetailClient product={variantProduct} />
              </WishlistProvider>
            </CartProvider>
          </AuthProvider>
        </StorefrontConfigProvider>
      </React.StrictMode>,
    );
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(viewContentCalls()).toHaveLength(1);
  });

  it('product A → product B (different product mount) → 2 distinct logical events', async () => {
    const first = renderDetail(simpleProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    // navigation unmounts the old page and mounts a fresh one with the new product
    first.unmount();
    renderDetail({ ...simpleProduct, id: 'p-other', sku: 'TOY-2', name: 'Other Toy' });
    await waitFor(() => expect(viewContentCalls()).toHaveLength(2));
    const ids = viewContentCalls().map((c: any[]) => c[3].eventID as string);
    expect(ids[1]).not.toBe(ids[0]);
    expect(viewContentCalls()[1][2].content_ids).toEqual(['TOY-2']);
  });

  it('back/forward remount of the SAME product in the same bucket → collapse (identical event_id)', async () => {
    const first = renderDetail(simpleProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    const firstId = viewContentCalls()[0][3].eventID as string;
    // back/forward navigation is a FULL remount — a fresh component instance
    first.unmount();
    renderDetail(simpleProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(2));
    const secondId = viewContentCalls()[1][3].eventID as string;
    expect(secondId).toBe(firstId);
  });
});
describe('ProductDetailClient — zero/negative stock is out of stock', () => {
  beforeEach(() => {
    localStorage.clear();
    setConsent(false, true);
    window.fbq = vi.fn();
    window.ttq = { track: vi.fn(), page: vi.fn() };
    setPixelIds('TEST-META-ID', 'TEST-TIKTOK-CODE');
    initMetaPixel();
    apiClientGetMock.mockClear();
    apiClientGetMock.mockResolvedValue({ data: [] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
  });

  const renderDetail = (product: any) =>
    render(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <AuthProvider>
          <CartProvider>
            <WishlistProvider>
              <ProductDetailClient product={product} />
            </WishlistProvider>
          </CartProvider>
        </AuthProvider>
      </StorefrontConfigProvider>,
    );

  it('negative stock renders the Out of Stock state with a disabled CTA', () => {
    renderDetail({
      ...simpleProduct,
      stock: -2,
      availabilityMode: 'MANAGED_STOCK',
    });
    const cta = screen.getByRole('button', { name: /OUT OF STOCK/i });
    expect(cta).toBeDisabled();
    expect(screen.getByText('Out of Stock')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ADD TO CART/i })).not.toBeInTheDocument();
  });

  it('zero stock keeps the Out of Stock state', () => {
    renderDetail({
      ...simpleProduct,
      stock: 0,
      availabilityMode: 'MANAGED_STOCK',
    });
    expect(screen.getByRole('button', { name: /OUT OF STOCK/i })).toBeDisabled();
  });

  it('positive stock renders an enabled ADD TO CART button', () => {
    renderDetail({
      ...simpleProduct,
      stock: 10,
      availabilityMode: 'MANAGED_STOCK',
    });
    expect(screen.getByRole('button', { name: /ADD TO CART/i })).not.toBeDisabled();
  });
});
