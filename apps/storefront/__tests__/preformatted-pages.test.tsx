import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notFound } from 'next/navigation';
import { getCmsPageBySlug } from '@/lib/api/cms-pages';
import { preFormattedPages } from '@/lib/templates/registry';
import { renderPreFormattedPage } from '@/lib/templates/render-page';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/api/cms-pages', () => ({ getCmsPageBySlug: vi.fn() }));

const mockGet = getCmsPageBySlug as unknown as ReturnType<typeof vi.fn>;
const mockNotFound = notFound as unknown as ReturnType<typeof vi.fn>;

const EXPECTED_KEYS = [
  'careers',
  'about',
  'company',
  'faq',
  'contact',
  'stores',
  'delivery-areas',
  'terms-conditions',
  'privacy-policy',
  'refund-policy',
  'exchange-policy',
  'shipping-policy',
  'download',
];

describe('pre-formatted pages', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockNotFound.mockReset();
  });

  it('registers all 13 system pages with a component, slug, and defaults', () => {
    expect(Object.keys(preFormattedPages).sort()).toEqual([...EXPECTED_KEYS].sort());
    for (const key of EXPECTED_KEYS) {
      const def = preFormattedPages[key];
      expect(def, `missing definition for ${key}`).toBeDefined();
      expect(typeof def.component).toBe('function');
      expect(def.slug).toBeTruthy();
      expect(def.defaultConfig).toBeDefined();
    }
  });

  it('merges stored config over defaults and renders the page component', async () => {
    mockGet.mockResolvedValue({
      id: 'x',
      slug: 'careers',
      title: 'Careers',
      isActive: true,
      config: { hero: { title: 'CUSTOM HERO' } },
    });

    const el = (await renderPreFormattedPage('careers')) as any;
    expect(el).toBeTruthy();
    // stored field wins
    expect(el.props.config.hero.title).toBe('CUSTOM HERO');
    // default fields remain
    expect(el.props.config.jobs.length).toBeGreaterThan(0);
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('calls notFound when the page is toggled off', async () => {
    mockGet.mockResolvedValue({ id: 'x', slug: 'careers', isActive: false });
    await expect(renderPreFormattedPage('careers')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('calls notFound for an unknown template key', async () => {
    await expect(renderPreFormattedPage('does-not-exist')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('renders with defaults when no DB row exists yet', async () => {
    mockGet.mockResolvedValue(null);
    const el = (await renderPreFormattedPage('faq')) as any;
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(el.props.config.items.length).toBeGreaterThan(0);
  });
});
