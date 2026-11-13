import { describe, it, expect, vi } from 'vitest';
import { renderToReadableStream } from 'react-dom/server';
import { getFooterCmsPages } from '@/lib/api/cms-pages';
import CmsFooterLinks from '../CmsFooterLinks';

vi.mock('@/lib/api/cms-pages', () => ({ getFooterCmsPages: vi.fn() }));

const mockGet = getFooterCmsPages as unknown as ReturnType<typeof vi.fn>;

async function renderToHtml(props: { excludeUrls: string[] }): Promise<string> {
  const stream = await renderToReadableStream(<CmsFooterLinks {...props} />);
  // allReady waits for every Suspense boundary (the async CMS fetch) to resolve.
  await stream.allReady;
  return new Response(stream as unknown as BodyInit).text();
}

describe('CmsFooterLinks', () => {
  it('links content pages under /pages and template pages at the root', async () => {
    mockGet.mockResolvedValue([
      { id: '1', slug: 'shipping-info', title: 'Shipping Info', type: 'content' },
      { id: '2', slug: 'about', title: 'About us', type: 'template' },
    ]);
    const html = await renderToHtml({ excludeUrls: [] });
    expect(html).toContain('href="/pages/shipping-info"');
    expect(html).toContain('Shipping Info');
    expect(html).toContain('href="/about"');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('skips urls already present in the column', async () => {
    mockGet.mockResolvedValue([
      { id: '1', slug: 'shipping-info', title: 'Shipping Info', type: 'content' },
      { id: '2', slug: 'about', title: 'About us', type: 'template' },
    ]);
    const html = await renderToHtml({ excludeUrls: ['/about'] });
    expect(html).toContain('href="/pages/shipping-info"');
    expect(html).not.toContain('href="/about"');
  });

  it('renders nothing when there are no footer pages', async () => {
    mockGet.mockResolvedValue([]);
    const html = await renderToHtml({ excludeUrls: [] });
    expect(html).not.toContain('<li');
  });
});
