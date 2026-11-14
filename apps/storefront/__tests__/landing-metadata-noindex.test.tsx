import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateMetadata } from '@/app/(landing)/landing/[slug]/page';
import { serverFetch } from '@/lib/api-server';
import { getStorefrontConfigServer } from '@/lib/api/storefront-config-server';

vi.mock('@/lib/api-server', () => ({ serverFetch: vi.fn() }));
vi.mock('@/lib/api/storefront-config-server', () => ({ getStorefrontConfigServer: vi.fn() }));

const mockServerFetch = serverFetch as unknown as ReturnType<typeof vi.fn>;
const mockGetConfig = getStorefrontConfigServer as unknown as ReturnType<typeof vi.fn>;

const landingData = {
  id: 'lp-1',
  title: 'Winter Sale',
  slug: 'winter-sale',
  pageType: 'template',
  templateId: null,
  sections: [],
  customHtml: null,
  customCss: null,
  productIds: [],
  comboIds: [],
  trackingJson: {},
};

describe('landing generateMetadata — never indexed', () => {
  beforeEach(() => {
    mockServerFetch.mockReset();
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue({ store: { name: 'Test Store' }, branding: {} } as any);
  });

  it('published page → robots index:false, follow:false', async () => {
    mockServerFetch.mockResolvedValue(landingData);
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'winter-sale' }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it('null page (unpublished / draft preview) → STILL robots index:false, follow:false', async () => {
    mockServerFetch.mockRejectedValue(new Error('API error: 404 Not Found'));
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'draft-slug' }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});
