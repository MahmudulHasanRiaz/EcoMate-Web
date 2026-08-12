import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { StorefrontConfigProvider } from '@/context/StorefrontConfigContext';
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { WishlistProvider } from '@/context/WishlistContext';
import { setPixelIds, setConsent, initMetaPixel } from '@/lib/tracking';
import type { StorefrontConfig } from '@/lib/api/storefront-config';
import { getProducts } from '@/lib/api/products';
import ArchivePageClient, { type ArchivePageClientProps } from '../ArchivePageClient';

const { pushMock, searchParamsMock, getProductsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  searchParamsMock: vi.fn(() => new URLSearchParams()),
  getProductsMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock(),
}));
vi.mock('@/lib/api/products', () => ({ getProducts: getProductsMock }));
vi.mock('@/lib/api/auth', () => ({ getMe: vi.fn().mockResolvedValue(null) }));

const CONFIG = {
  currency: { code: 'BDT', symbol: '৳' },
} as unknown as StorefrontConfig;

const productA = {
  id: 'p1',
  sku: 'SKU-1',
  slug: 'shoes-a',
  name: 'Shoes A',
  price: 1000,
  originalPrice: 1200,
  image: null,
  images: null,
} as any;
const productB = {
  id: 'p2',
  sku: 'SKU-2',
  slug: 'boots-b',
  name: 'Boots B',
  price: 2000,
  image: null,
  images: null,
} as any;

describe('ArchivePageClient — search results page semantics', () => {
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
    pushMock.mockClear();
    searchParamsMock.mockClear();
    searchParamsMock.mockImplementation(() => new URLSearchParams());
    getProductsMock.mockReset();
    getProductsMock.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 2, perPage: 24, totalPages: 0, nextCursor: null, hasMore: false },
    });
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
    if (fetchSpy.mockRestore) void fetchSpy;
  });

  const renderArchive = (
    filters: ArchivePageClientProps['filters'],
    opts: { total?: number; items?: any[]; categories?: any[] } = {},
  ) =>
    render(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <CartProvider>
          <WishlistProvider>
            <AuthProvider>
              <ArchivePageClient
                initialItems={opts.items ?? [productA, productB]}
                initialCursor="c1"
                initialHasMore
                initialTotal={opts.total ?? 2}
                categories={opts.categories ?? []}
                filters={filters}
              />
            </AuthProvider>
          </WishlistProvider>
        </CartProvider>
      </StorefrontConfigProvider>,
    );

  const searchCalls = () => vi.mocked(window.fbq).mock.calls.filter((c: any[]) => c[1] === 'Search');

  it('search filters render the search heading and honest server-side result count', () => {
    renderArchive({ search: 'shoes' }, { total: 7 });
    expect(screen.getByText(/Search results for .shoes./)).toBeInTheDocument();
    expect(screen.getByText('7 products found')).toBeInTheDocument();
    expect(screen.getByText('Shoes A')).toBeInTheDocument();
  });

  it('committing the on-page search fires ONE Search event and navigates with search=...', () => {
    renderArchive({});
    const boxes = screen.getAllByLabelText('Search products');
    expect(boxes.length).toBe(2); // desktop + mobile instances

    fireEvent.change(boxes[0], { target: { value: 'boots' } });
    fireEvent.submit(screen.getAllByRole('search')[0]);

    expect(searchCalls()).toHaveLength(1);
    expect(searchCalls()[0][2]).toMatchObject({ search_string: 'boots', currency: 'BDT' });
    expect(searchCalls()[0][3].eventID).toMatch(/^search_boots_[0-9a-f]{8}_\d+$/);
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('search=boots'));
  });

  it('typing alone fires NO Search event', () => {
    renderArchive({});
    fireEvent.change(screen.getAllByLabelText('Search products')[0], { target: { value: 'boots' } });
    expect(searchCalls()).toHaveLength(0);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('sort change navigates but is NOT a Search', () => {
    renderArchive({});
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'price-low' } });
    expect(searchCalls()).toHaveLength(0);
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('sort=price-low'));
  });

  it('category selection navigates but is NOT a Search', () => {
    const categories = [
      { id: 'c1', slug: 'shoes', name: 'Shoes', parentId: null, children: [], _count: { products: 3 } },
    ];
    renderArchive({}, { categories });
    fireEvent.click(screen.getByText('Shoes'));
    expect(searchCalls()).toHaveLength(0);
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('category=shoes'));
  });

  it('paginating via the sentinel fetches more but is NOT a Search', () => {
    renderArchive({});
    const [observer] = (globalThis.IntersectionObserver as any).instances;
    act(() => observer.trigger(true));
    expect(getProductsMock).toHaveBeenCalled();
    expect(searchCalls()).toHaveLength(0);
  });

  it('whitespace-only commit is a no-op', () => {
    renderArchive({});
    fireEvent.submit(screen.getAllByRole('search')[1]);
    expect(searchCalls()).toHaveLength(0);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('no-result filters render the empty state without re-firing Search', () => {
    renderArchive({ search: 'xyzabc' }, { items: [], total: 0 });
    expect(screen.getByText('No Products Found')).toBeInTheDocument();
    expect(searchCalls()).toHaveLength(0);
  });
});