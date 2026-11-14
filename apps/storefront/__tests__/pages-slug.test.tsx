import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import CmsPageView, { generateMetadata } from '@/app/(main)/pages/[slug]/page';
import { getCmsPageBySlug } from '@/lib/api/cms-pages';
import { getStorefrontConfigServer } from '@/lib/api/storefront-config-server';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: any) => <a href={typeof href === 'string' ? href : href?.pathname}>{children}</a>,
}));
vi.mock('@/lib/api/cms-pages', () => ({ getCmsPageBySlug: vi.fn() }));
vi.mock('@/lib/api/storefront-config-server', () => ({ getStorefrontConfigServer: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: 'demo.ecomate.bd' })),
}));

const mockGet = getCmsPageBySlug as unknown as ReturnType<typeof vi.fn>;
const mockGetConfig = getStorefrontConfigServer as unknown as ReturnType<typeof vi.fn>;

const contentPage = (overrides: Record<string, unknown> = {}) => ({
  id: 'p-1',
  slug: 'privacy',
  title: 'Privacy Policy',
  content: '<p>We collect very little.</p>',
  isActive: true,
  showInFooter: true,
  sortOrder: 0,
  type: 'content',
  templateKey: null,
  config: null,
  metaDescription: null,
  ogImage: null,
  effectiveDate: null,
  version: 1,
  createdAt: '2026-11-13T00:00:00.000Z',
  updatedAt: '2026-11-13T00:00:00.000Z',
  ...overrides,
});

describe('pages/[slug]', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue({ store: { name: 'Test Store' } } as any);
  });

  it('template-type row → notFound (the template route is its canonical URL)', async () => {
    mockGet.mockResolvedValue(contentPage({ type: 'template', slug: 'careers', title: 'Careers' }));
    await expect(CmsPageView({ params: Promise.resolve({ slug: 'careers' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('content page renders its content', async () => {
    mockGet.mockResolvedValue(contentPage());
    const html = renderToString(await CmsPageView({ params: Promise.resolve({ slug: 'privacy' }) }));
    expect(html).toContain('We collect very little.');
    expect(html).not.toContain("doesn't have any content yet");
  });

  it('content page with empty content → honest empty state, no empty white box', async () => {
    mockGet.mockResolvedValue(contentPage({ content: '' }));
    const html = renderToString(await CmsPageView({ params: Promise.resolve({ slug: 'privacy' }) }));
    expect(html).toContain("doesn&#x27;t have any content yet");
    // No content box is rendered (the <style> block legitimately still
    // mentions .cms-content selectors — only the div must be absent).
    expect(html).not.toContain('class="cms-content');
  });

  it('content page with tag-only content counts as empty', async () => {
    mockGet.mockResolvedValue(contentPage({ content: '<p>&nbsp;</p>' }));
    const html = renderToString(await CmsPageView({ params: Promise.resolve({ slug: 'privacy' }) }));
    expect(html).toContain("doesn&#x27;t have any content yet");
  });

  it('template-type row metadata → noindex', async () => {
    mockGet.mockResolvedValue(contentPage({ type: 'template', slug: 'careers', title: 'Careers' }));
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'careers' }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it('empty content page metadata → noindex', async () => {
    mockGet.mockResolvedValue(contentPage({ content: '' }));
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'privacy' }) });
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('content page metadata → bare title (no store suffix; layout template appends it once)', async () => {
    mockGet.mockResolvedValue(contentPage());
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'privacy' }) });
    expect(meta.title).toBe('Privacy Policy');
    expect(meta.robots).toBeUndefined();
  });
});
