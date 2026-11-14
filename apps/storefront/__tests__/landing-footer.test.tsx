import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import LandingFooter from '@/components/landing/LandingFooter';
import { getStorefrontConfigServer } from '@/lib/api/storefront-config-server';

vi.mock('@/lib/api/storefront-config-server', () => ({ getStorefrontConfigServer: vi.fn() }));

const mockGetConfig = getStorefrontConfigServer as unknown as ReturnType<typeof vi.fn>;

const configWithContact = {
  store: {
    name: 'Test Store',
    tagline: 'Real tagline',
    phone: '01711111111',
    email: 'hello@teststore.example',
    address: '',
  },
};

describe('LandingFooter — contact bound to store config', () => {
  beforeEach(() => {
    mockGetConfig.mockReset();
  });

  it('renders the configured phone and email, no dummies', async () => {
    mockGetConfig.mockResolvedValue(configWithContact as any);
    const html = renderToString(await LandingFooter());
    expect(html).toContain('01711111111');
    expect(html).toContain('hello@teststore.example');
    expect(html).toContain('Test Store');
    expect(html).not.toContain('01XXXXXXXXX');
    expect(html).not.toContain('support@example.com');
  });

  it('renders no contact block at all when phone/email are unset', async () => {
    mockGetConfig.mockResolvedValue({
      store: { name: 'Test Store', tagline: '', phone: '', email: '', address: '' },
    } as any);
    const html = renderToString(await LandingFooter());
    expect(html).not.toContain('Contact Us');
    expect(html).not.toContain('WhatsApp:');
    expect(html).not.toContain('Email:');
    expect(html).not.toContain('01XXXXXXXXX');
    expect(html).not.toContain('support@example.com');
    expect(html).toContain('Test Store');
  });

  it('renders only the lines that are set (phone without email)', async () => {
    mockGetConfig.mockResolvedValue({
      store: { name: 'Test Store', tagline: '', phone: '01711111111', email: '', address: '' },
    } as any);
    const html = renderToString(await LandingFooter());
    // (renderToString puts a <!-- --> comment between the "WhatsApp: "
    // text node and the phone expression — assert the parts separately.)
    expect(html).toContain('WhatsApp:');
    expect(html).toContain('01711111111');
    expect(html).not.toContain('Email:');
  });
});
