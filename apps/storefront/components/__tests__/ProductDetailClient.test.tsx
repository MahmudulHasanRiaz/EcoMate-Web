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

  it('variable product waits for a resolved variant and fires with the VARIANT catalog id', async () => {
    renderDetail(variantProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    expect(viewContentCalls()[0][2]).toMatchObject({
      content_ids: ['CWB-1-44'],
      value: 3400,
    });
  });

  it('variant switch 44 → 46 → NEW ViewContent with the new variant catalog id', async () => {
    renderDetail(variantProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    expect(viewContentCalls()[0][2].content_ids).toEqual(['CWB-1-44']);
    fireEvent.click(screen.getByRole('button', { name: '46' }));
    await waitFor(() => expect(viewContentCalls()).toHaveLength(2));
    expect(viewContentCalls()[1][2]).toMatchObject({ content_ids: ['CWB-1-46'], value: 3600 });
    const ids = viewContentCalls().map((c: any[]) => c[3].eventID as string);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it('re-selecting the SAME variant → NO additional ViewContent', async () => {
    renderDetail(variantProduct);
    await waitFor(() => expect(viewContentCalls()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '44' }));
    fireEvent.click(screen.getByRole('button', { name: '46' }));
    await waitFor(() => expect(viewContentCalls()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '46' }));
    expect(viewContentCalls()).toHaveLength(2);
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