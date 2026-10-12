import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site-url';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = siteUrl() || 'https://example.com';
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/account', '/admin', '/checkout', '/cart', '/orders', '/wishlist'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
