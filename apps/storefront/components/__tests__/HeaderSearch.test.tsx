import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { StorefrontConfigProvider } from '@/context/StorefrontConfigContext';
import { AuthProvider } from '@/context/AuthContext';
import { setPixelIds, setConsent, initMetaPixel } from '@/lib/tracking';
import type { StorefrontConfig } from '@/lib/api/storefront-config';
import { getProducts } from '@/lib/api/products';
import type { ProductsResponse } from '@/lib/api/products';
import { HeaderSearch, _resetAutocompleteCache } from '../HeaderSearch';

const { pushMock, getProductsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  getProductsMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/lib/api/products', () => ({ getProducts: getProductsMock }));
vi.mock('@/lib/api/auth', () => ({ getMe: vi.fn().mockResolvedValue(null) }));

const CONFIG = {
  currency: { code: 'BDT', symbol: '৳' },
} as unknown as StorefrontConfig;

const shoesA = {
  id: 'p1',
  slug: 'shoes-a',
  name: 'Shoes A',
  price: 1000,
  originalPrice: 1200,
  image: null,
  brand: { name: 'Brand X' },
} as any;
const bootsB = {
  id: 'p2',
  slug: 'boots-b',
  name: 'Boots B',
  price: 2000,
  brand: { name: 'Brand Y' },
} as any;

const makeRes = (data: any[]): ProductsResponse => ({
  data,
  meta: { total: data.length, page: 1, perPage: 5, totalPages: 1, nextCursor: null, hasMore: false },
});

describe('HeaderSearch — premium search bar', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let resolvers: ((r: ProductsResponse) => void)[];

  beforeEach(() => {
    vi.useFakeTimers();
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
    _resetAutocompleteCache();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);

    resolvers = [];
    getProductsMock.mockReset();
    getProductsMock.mockImplementation(
      () => new Promise<ProductsResponse>((resolve) => resolvers.push(resolve)),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  const renderSearch = (props: { onCloseMobile?: () => void; autoFocus?: boolean } = {}) =>
    render(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <AuthProvider>
          <HeaderSearch {...props} />
        </AuthProvider>
      </StorefrontConfigProvider>,
    );

  const searchCalls = () => vi.mocked(window.fbq).mock.calls.filter((c: any[]) => c[1] === 'Search');
  const type = (input: HTMLElement, value: string) =>
    act(() => fireEvent.change(input, { target: { value } }));
  const debounce = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  const deliver = (data: any[]) =>
    act(async () => {
      const r = resolvers.shift();
      expect(r).toBeDefined();
      r!(makeRes(data));
    });

  it('typing only — autocomplete fetches and renders, but NO Search event and no navigation', async () => {
    renderSearch();
    const input = screen.getByRole('combobox');
    type(input, 'sho');
    debounce(250);
    await deliver([shoesA]);

    expect(getProductsMock).toHaveBeenCalledTimes(1);
    expect(getProductsMock.mock.calls[0][0].search).toBe('sho');
    expect(screen.getByText('Shoes A')).toBeInTheDocument();
    expect(searchCalls()).toHaveLength(0);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('rapid keystrokes coalesce into a single autocomplete request (debounce)', () => {
    renderSearch();
    const input = screen.getByRole('combobox');
    type(input, 's');
    debounce(100);
    type(input, 'sh');
    debounce(100);
    type(input, 'sho');
    debounce(250);

    expect(getProductsMock).toHaveBeenCalledTimes(1);
    expect(getProductsMock.mock.calls[0][0].search).toBe('sho');
  });

  it('stale "sho" response can never overwrite the newer "shoes" results', async () => {
    renderSearch();
    const input = screen.getByRole('combobox');
    type(input, 'sho');
    debounce(250);
    type(input, 'shoes');
    debounce(250);

    expect(getProductsMock).toHaveBeenCalledTimes(2);
    expect(getProductsMock.mock.calls[0][0].signal?.aborted).toBe(true);
    expect(getProductsMock.mock.calls[1][0].signal?.aborted).toBe(false);

    await deliver([shoesA]);
    expect(screen.queryByText('Shoes A')).not.toBeInTheDocument();

    await deliver([bootsB]);
    expect(screen.getByText('Boots B')).toBeInTheDocument();
  });

  it('Enter commits ONE Search with the normalized query and navigates to results (Case A)', () => {
    renderSearch();
    const input = screen.getByRole('combobox');
    type(input, '  shoes  ');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(searchCalls()).toHaveLength(1);
    expect(searchCalls()[0][2]).toMatchObject({ search_string: 'shoes', currency: 'BDT' });
    expect(searchCalls()[0][3].eventID).toMatch(/^search_shoes_[0-9a-f]{8}_\d+$/);
    expect(pushMock).toHaveBeenCalledWith('/products?search=shoes');
  });

  it('whitespace-only Enter sends NO event and does not navigate', () => {
    renderSearch();
    const input = screen.getByRole('combobox');
    type(input, '    ');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(searchCalls()).toHaveLength(0);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('ArrowDown/ArrowUp navigate suggestions; Enter commits the highlighted one (Case F)', async () => {
    renderSearch();
    const input = screen.getByRole('combobox');
    type(input, 'sho');
    debounce(250);
    await deliver([shoesA, bootsB]);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'header-search-option-0');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'header-search-option-1');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(pushMock).toHaveBeenCalledWith('/products/boots-b');
    expect(searchCalls()).toHaveLength(1);
    // the string the user typed is committed — suggestions are navigations, not rewrites
    expect(searchCalls()[0][2].search_string).toBe('sho');
  });

  it('Escape closes the panel first, then clears the input; no Search', async () => {
    renderSearch();
    const input = screen.getByRole('combobox');
    type(input, 'sho');
    debounce(250);
    await deliver([shoesA]);
    expect(input).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');
    expect(searchCalls()).toHaveLength(0);
  });

  it('clear button empties the input without tracking or navigation', () => {
    renderSearch();
    const input = screen.getByRole('combobox');
    type(input, 'shoes');
    fireEvent.click(screen.getByLabelText('Clear search'));

    expect((input as HTMLInputElement).value).toBe('');
    expect(searchCalls()).toHaveLength(0);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('suggestion click navigates to the product with one committed Search', async () => {
    renderSearch();
    const input = screen.getByRole('combobox');
    type(input, 'sho');
    debounce(250);
    await deliver([shoesA]);

    fireEvent.click(screen.getByText('Shoes A'));
    expect(pushMock).toHaveBeenCalledWith('/products/shoes-a');
    expect(searchCalls()).toHaveLength(1);
    expect(searchCalls()[0][2].search_string).toBe('sho');
  });

  it('"view all results" commits the typed query', async () => {
    renderSearch();
    const input = screen.getByRole('combobox');
    type(input, 'sho');
    debounce(250);
    await deliver([shoesA]);

    fireEvent.click(screen.getByText(/View all results/));
    expect(pushMock).toHaveBeenCalledWith('/products?search=sho');
    expect(searchCalls()).toHaveLength(1);
  });

  it('no-result autocomplete shows the empty state and stays silent', async () => {
    renderSearch();
    const input = screen.getByRole('combobox');
    type(input, 'xyzabc');
    debounce(250);
    await deliver([]);

    expect(screen.getByText(/No products found/)).toBeInTheDocument();
    expect(searchCalls()).toHaveLength(0);
  });

  it('mobile instance requests autofocus (touch-optimised flow)', () => {
    renderSearch({ autoFocus: true });
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
  });

  it('onCloseMobile is called when a commit navigates away on mobile', async () => {
    const onCloseMobile = vi.fn();
    renderSearch({ onCloseMobile, autoFocus: true });
    const input = screen.getByRole('combobox');
    type(input, 'shoes');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCloseMobile).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/products?search=shoes');
  });
});