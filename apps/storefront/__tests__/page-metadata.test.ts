import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pageMetadata } from '@/lib/metadata';
import { getStorefrontConfigServer } from '@/lib/api/storefront-config-server';

vi.mock('@/lib/api/storefront-config-server', () => ({ getStorefrontConfigServer: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: 'demo.ecomate.bd' })),
}));

const mockGetConfig = getStorefrontConfigServer as unknown as ReturnType<typeof vi.fn>;

describe('pageMetadata — bare title, request-host canonical', () => {
  beforeEach(() => {
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue({ store: { name: 'Test Store' } } as any);
    delete process.env.NEXT_PUBLIC_STOREFRONT_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
  });

  it('returns the bare title (root layout template appends the store name once)', async () => {
    const meta = await pageMetadata('Careers', 'Work with us.', '/careers');
    expect(meta.title).toBe('Careers');
    expect(meta.title).not.toContain('Test Store');
  });

  it('canonical uses the request host, not the env placeholder', async () => {
    const meta = await pageMetadata('Careers', 'Work with us.', '/careers');
    expect(meta.alternates?.canonical).toBe('https://demo.ecomate.bd/careers');
  });

  it('OG/Twitter titles are bare too', async () => {
    const meta = await pageMetadata('Careers', 'Work with us.', '/careers', 'https://cdn.example.com/og.jpg');
    expect(meta.openGraph?.title).toBe('Careers');
    expect(meta.twitter?.title).toBe('Careers');
  });
});
