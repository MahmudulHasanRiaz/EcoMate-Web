import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notFound } from 'next/navigation';
import { getCmsPageBySlug } from '@/lib/api/cms-pages';
import { preFormattedPages, templateHasRealContent } from '@/lib/templates/registry';
import { renderPreFormattedPage } from '@/lib/templates/render-page';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/api/cms-pages', () => ({ getCmsPageBySlug: vi.fn() }));
vi.mock('@/lib/api/storefront-config-server', () => ({
  getStorefrontConfigServer: vi.fn(async () => ({ store: { name: 'Test Store' } })),
}));

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
    // neutral defaults remain (no fake jobs seeded)
    expect(el.props.config.jobs).toEqual([]);
    // real store name is passed through from store settings
    expect(el.props.storeName).toBe('Test Store');
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

  it('renders with neutral empty defaults when no DB row exists yet', async () => {
    mockGet.mockResolvedValue(null);
    const el = (await renderPreFormattedPage('faq')) as any;
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(el.props.config.items).toEqual([]);
  });
});

describe('templateHasRealContent', () => {
  it('returns false for every neutral default config (D8: unconfigured pages are content-less)', () => {
    for (const key of EXPECTED_KEYS) {
      expect(
        templateHasRealContent(key, preFormattedPages[key].defaultConfig),
        `${key} neutral defaults must not count as real content`,
      ).toBe(false);
    }
  });

  it('returns false for unknown keys and missing configs', () => {
    expect(templateHasRealContent('does-not-exist', { sections: [{ heading: 'x', body: 'y' }] })).toBe(false);
    expect(templateHasRealContent('faq', null)).toBe(false);
    expect(templateHasRealContent('faq', undefined)).toBe(false);
  });

  it('returns true once a page has real configured content', () => {
    const cases: [string, Record<string, any>][] = [
      ['careers', { hero: { title: '', subtitle: '', image: '' }, jobs: [{ title: 'Cook' }], benefits: [], application: { email: '', ctaText: '' } }],
      ['about', { story: 'We started in 2020.', tagline: '', values: [], image: '' }],
      ['company', { name: 'Acme Ltd', registration: '', certifications: '', teamSize: '', ceoName: '', established: '', tagline: '', philosophy: '', vision: '', impact: '', image: '' }],
      ['faq', { items: [{ question: 'Q?', answer: 'A.' }] }],
      ['contact', { phone: '+8801000000000', email: '', address: '', whatsapp: '', hours: [] }],
      ['stores', { stores: [{ name: 'Main' }] }],
      ['delivery-areas', { areas: [{ zone: 'Dhaka', areas: [], charge: '', deliveryTime: '' }], freeDeliveryMin: 0 }],
      ['terms-conditions', { intro: '', sections: [{ heading: '1. Terms', body: 'Be nice.' }] }],
      ['privacy-policy', { intro: '', sections: [{ heading: 'Data', body: 'We collect little.' }] }],
      ['refund-policy', { intro: '', sections: [], notice: { title: '', body: '' }, contactEmail: 'support@example.com' }],
      ['exchange-policy', { intro: '', quote: '', sections: [{ heading: 'Steps', body: 'Call us.', kind: 'step' }] }],
      ['shipping-policy', { intro: '', sections: [{ heading: 'Times', body: 'Fast.' }], deliveryCharge: 0, freeDeliveryMin: 0 }],
      ['download', { androidUrl: 'https://play.example/app', iosUrl: '', heading: '', description: '', image: '', features: [], qrCodeUrl: '', version: '', apkUrl: '' }],
    ];
    for (const [key, config] of cases) {
      expect(templateHasRealContent(key, config), `${key} with content`).toBe(true);
    }
  });
});
