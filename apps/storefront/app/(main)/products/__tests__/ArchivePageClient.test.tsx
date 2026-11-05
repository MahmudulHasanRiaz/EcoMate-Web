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
vi.mock('@/lib/api/products', () => ({ getProducts: getProductsMock, getProductCards: getProductsMock }));
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

describe('ArchivePageClient — ViewContent strict semantics (passive grids fire ZERO)', () => {
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

  const viewContentCalls = () => vi.mocked(window.fbq).mock.calls.filter((c: any[]) => c[1] === 'ViewContent');
  const viewContentMirrors = () =>
    fetchSpy.mock.calls.filter((c: any[]) => {
      try {
        const body = JSON.parse(String(c[1]?.body));
        return body.eventName === 'view_content';
      } catch {
        return false;
      }
    });

  it('category page rendering product cards → ZERO ViewContent (pixel AND mirror)', () => {
    renderArchive({ category: 'shoes' }, { total: 2 });
    expect(screen.getByText('Shoes A')).toBeInTheDocument();
    expect(screen.getByText('Boots B')).toBeInTheDocument();
    expect(viewContentCalls()).toHaveLength(0);
    expect(viewContentMirrors()).toHaveLength(0);
  });

  it('search results rendering product cards → ZERO ViewContent', () => {
    renderArchive({ search: 'boots' }, { total: 2 });
    expect(viewContentCalls()).toHaveLength(0);
    expect(viewContentMirrors()).toHaveLength(0);
  });

  it('category change (filter navigation) → ZERO ViewContent', () => {
    const categories = [
      { id: 'c1', slug: 'shoes', name: 'Shoes', parentId: null, children: [], _count: { products: 3 } },
    ];
    renderArchive({}, { categories });
    fireEvent.click(screen.getAllByText('Shoes')[0]);
    expect(viewContentCalls()).toHaveLength(0);
    expect(viewContentMirrors()).toHaveLength(0);
  });

  it('sort/filter changes → ZERO ViewContent', () => {
    renderArchive({ sort: 'price-low', minPrice: '100' });
    expect(viewContentCalls()).toHaveLength(0);
    expect(viewContentMirrors()).toHaveLength(0);
  });

  it('scroll/pagination loading more products → ZERO ViewContent', () => {
    renderArchive({});
    const [observer] = (globalThis.IntersectionObserver as any).instances;
    act(() => observer.trigger(true));
    expect(getProductsMock).toHaveBeenCalled();
    expect(viewContentCalls()).toHaveLength(0);
    expect(viewContentMirrors()).toHaveLength(0);
  });
});
describe('ArchivePageClient — refetch bug regression (param change without remount)', () => {
  beforeEach(() => {
    localStorage.clear();
    setConsent(false, true);
    window.fbq = vi.fn();
    pushMock.mockClear();
    searchParamsMock.mockClear();
    searchParamsMock.mockImplementation(() => new URLSearchParams());
    getProductsMock.mockReset();
    getProductsMock.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 2, perPage: 24, totalPages: 0, nextCursor: null, hasMore: false },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
  });

  const productWatch = {
    id: 'p3', sku: 'SKU-3', slug: 'watch-c', name: 'Watch C', price: 3000, image: null, images: null,
  } as any;
  const productAccessory = {
    id: 'p4', sku: 'SKU-4', slug: 'strap-d', name: 'Strap D', price: 500, image: null, images: null,
  } as any;

  const element = (
    filters: ArchivePageClientProps['filters'],
    opts: { total?: number; items?: any[]; categories?: any[] } = {},
  ) => (
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
    </StorefrontConfigProvider>
  );

  it('search A → search B: new props drive the rendered list, heading and search box', () => {
    const view = render(element({ search: 'shoes' }, { items: [productA], total: 1 }));
    expect(screen.getByText('Shoes A')).toBeInTheDocument();

    // Same component instance (no key/remount) — the same-route navigation path.
    view.rerender(element({ search: 'watch' }, { items: [productWatch], total: 1 }));

    expect(screen.getByText('Watch C')).toBeInTheDocument();
    expect(screen.queryByText('Shoes A')).not.toBeInTheDocument();
    expect(screen.getByText(/Search results for .watch./)).toBeInTheDocument();
    for (const box of screen.getAllByLabelText('Search products')) {
      expect((box as HTMLInputElement).value).toBe('watch');
    }
  });

  it('category param change: list is replaced and the category checkbox shows selected', () => {
    const categories = [
      { id: 'c9', slug: 'accessories', name: 'Accessories', parentId: null, children: [], _count: { products: 1 } },
    ];
    const view = render(element({}, { categories }));
    expect(screen.getByText('Shoes A')).toBeInTheDocument();

    view.rerender(element({ category: 'accessories' }, { items: [productAccessory], categories, total: 1 }));

    expect(screen.getByText('Strap D')).toBeInTheDocument();
    expect(screen.queryByText('Shoes A')).not.toBeInTheDocument();
    // The category name span carries the selected styling only when
    // selectedCategorySlug was re-synced from the new filters.
    const nameSpan = screen
      .getAllByText('Accessories')
      .find((el) => el.tagName === 'SPAN');
    expect(nameSpan?.className).toContain('text-brand-blue');
  });

  it('clearing search: stale heading/results are replaced by the full catalog', () => {
    const view = render(element({ search: 'watch' }, { items: [productWatch], total: 1 }));
    expect(screen.getByText(/Search results for .watch./)).toBeInTheDocument();

    view.rerender(element({}, { items: [productA, productB], total: 2 }));

    expect(screen.queryByText(/Search results for/)).not.toBeInTheDocument();
    expect(screen.getByText('Shoes A')).toBeInTheDocument();
    expect(screen.queryByText('Watch C')).not.toBeInTheDocument();
    for (const box of screen.getAllByLabelText('Search products')) {
      expect((box as HTMLInputElement).value).toBe('');
    }
  });

  it('sort param change drives load-more fetches with the NEW sort (not the mount-time sort)', async () => {
    const view = render(element({}));
    view.rerender(element({ sort: 'price-low' }));

    const observers = (globalThis.IntersectionObserver as any).instances;
    expect(observers.length).toBeGreaterThan(0);
    for (const o of observers) act(() => o.trigger(true));

    await vi.waitFor(() => expect(getProductsMock).toHaveBeenCalled());
    expect(getProductsMock).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'basePrice', order: 'asc', search: undefined }),
    );
  });

  it('a no-op filter navigation never leaves a stuck "Updating…" overlay', () => {
    render(element({}));
    // Price Apply with empty min/max pushes the unchanged URL (the old code
    // set a manual navigating flag that only a filters-prop change cleared).
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(pushMock).toHaveBeenCalled();
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
  });

  it('grid cards are wrapped for content-visibility (long-list rendering cost)', () => {
    render(element({}));
    const wrappers = document.querySelectorAll('[data-plp-card]');
    expect(wrappers.length).toBe(2);
    for (const w of wrappers) {
      expect(w.className).toContain('[content-visibility:auto]');
      expect(w.className).toContain('[contain-intrinsic-size:');
    }
  });
});

describe('ArchivePageClient — server facet lists (PLP scale round)', () => {
  beforeEach(() => {
    localStorage.clear();
    setConsent(false, true);
    window.fbq = vi.fn();
    pushMock.mockClear();
    searchParamsMock.mockClear();
    searchParamsMock.mockImplementation(() => new URLSearchParams());
    getProductsMock.mockReset();
    getProductsMock.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 2, perPage: 24, totalPages: 0, nextCursor: null, hasMore: false },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
  });

  // Facet slugs deliberately differ from what slugifying the name would
  // produce ('acme-corp' / 'sale-items'), so a navigation carrying the
  // facet slug proves the SERVER list — not name derivation — was used.
  const brandFacets = [
    { name: 'Acme Corp', slug: 'acme-corp-bd' },
    { name: 'Zenith', slug: 'zenith' },
  ];
  const tagFacets = [{ name: 'Sale Items', slug: 'sale-items-bd' }];

  const renderFacets = (
    filters: ArchivePageClientProps['filters'],
    opts: {
      items?: any[];
      brandFacets?: ArchivePageClientProps['brandFacets'];
      tagFacets?: ArchivePageClientProps['tagFacets'];
      cursor?: string | null;
      hasMore?: boolean;
    } = {},
  ) =>
    render(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <CartProvider>
          <WishlistProvider>
            <AuthProvider>
              <ArchivePageClient
                initialItems={opts.items ?? [productA, productB]}
                initialCursor={opts.cursor ?? null}
                initialHasMore={opts.hasMore ?? false}
                initialTotal={2}
                categories={[]}
                brandFacets={opts.brandFacets}
                tagFacets={opts.tagFacets}
                filters={filters}
              />
            </AuthProvider>
          </WishlistProvider>
        </CartProvider>
      </StorefrontConfigProvider>,
    );

  const facetCheckbox = (label: string) => {
    const labelEl = screen.getByText(label).closest('label');
    return labelEl?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  };

  it('brand/tag options come from the server facet props — complete with zero scrolling', () => {
    // productA/productB carry no brand and no tags: under the old
    // item-derived options the sidebar lists would be EMPTY here.
    renderFacets({}, { brandFacets, tagFacets });
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Zenith')).toBeInTheDocument();
    expect(screen.getByText('Sale Items')).toBeInTheDocument();
  });

  it('the active brand shows selected via the facet slug even when no loaded item carries it', () => {
    renderFacets({ brand: 'acme-corp-bd' }, { brandFacets, tagFacets });
    const nameSpan = screen.getByText('Acme Corp');
    expect(nameSpan.className).toContain('font-bold');
    expect(facetCheckbox('Acme Corp')?.checked).toBe(true);
    expect(facetCheckbox('Zenith')?.checked).toBe(false);
  });

  it('toggling a facet brand navigates with the SERVER slug, not a name-derived one', () => {
    renderFacets({}, { brandFacets, tagFacets });
    fireEvent.click(facetCheckbox('Acme Corp') as HTMLElement);
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('brand=acme-corp-bd'));
  });

  it('toggling a facet tag navigates with the SERVER slug', () => {
    renderFacets({}, { brandFacets, tagFacets });
    fireEvent.click(facetCheckbox('Sale Items') as HTMLElement);
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('tag=sale-items-bd'));
  });

  it('fallback: with no facet props, options derive from loaded items as before', () => {
    const branded = {
      id: 'p7', sku: 'SKU-7', slug: 'branded-thing', name: 'Branded Thing', price: 700,
      image: null, images: null,
      brand: { id: 'b7', name: 'ItemBrand', slug: 'item-brand' },
      tags: ['ItemTag'],
    } as any;
    renderFacets({}, { items: [branded] });
    expect(screen.getByText('ItemBrand')).toBeInTheDocument();
    expect(screen.getByText('ItemTag')).toBeInTheDocument();
  });

  it('price sort pages by cursor: each server nextCursor is passed verbatim to the next fetch', async () => {
    getProductsMock.mockReset();
    getProductsMock
      .mockResolvedValueOnce({
        data: [{ ...productB, id: 'p9' }],
        meta: { total: 50, perPage: 24, nextCursor: 'KEYSET_PAGE_2', hasMore: true },
      })
      .mockResolvedValue({
        data: [],
        meta: { total: 50, perPage: 24, nextCursor: null, hasMore: false },
      });

    renderFacets({ sort: 'price-high' }, { cursor: 'SEED_CURSOR', hasMore: true });

    const triggerSentinels = () => {
      const observers = (globalThis.IntersectionObserver as any).instances;
      for (const o of observers) act(() => o.trigger(true));
    };

    triggerSentinels();
    await vi.waitFor(() => expect(getProductsMock).toHaveBeenCalled());
    expect(getProductsMock.mock.calls[0][0]).toMatchObject({
      sort: 'basePrice',
      order: 'desc',
      cursor: 'SEED_CURSOR',
    });

    triggerSentinels();
    await vi.waitFor(() =>
      expect(
        getProductsMock.mock.calls.some((c: any[]) => c[0]?.cursor === 'KEYSET_PAGE_2'),
      ).toBe(true),
    );
    // Ordering: the keyset cursor is only ever requested AFTER the seed
    // cursor page has been fetched (no page-number mode anywhere).
    const cursors = getProductsMock.mock.calls.map((c: any[]) => c[0]?.cursor);
    expect(cursors.indexOf('KEYSET_PAGE_2')).toBeGreaterThan(cursors.indexOf('SEED_CURSOR'));
    for (const call of getProductsMock.mock.calls) {
      expect(call[0]).toMatchObject({ sort: 'basePrice', order: 'desc' });
      expect(call[0].page).toBeUndefined();
    }
  });
});
