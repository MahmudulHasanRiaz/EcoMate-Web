import type { MetadataRoute } from 'next';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://example.com';

  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: 'daily' as const, priority: 1 },
    { url: `${baseUrl}/about`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${baseUrl}/faq`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${baseUrl}/privacy-policy`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${baseUrl}/terms-conditions`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${baseUrl}/shipping-policy`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${baseUrl}/refund-policy`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${baseUrl}/exchange-policy`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${baseUrl}/delivery-areas`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.4 },
    { url: `${baseUrl}/stores`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.4 },
    { url: `${baseUrl}/support`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.4 },
    { url: `${baseUrl}/careers`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.4 },
    { url: `${baseUrl}/combos`, lastModified: new Date(), changeFrequency: 'daily' as const, priority: 0.8 },
  ];

  const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

  // Fetch categories for dynamic category pages
  let categoryPages: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(`${apiUrl}/categories?isActive=true`);
    const data = await res.json();
    const categories = data.data || data || [];
    if (Array.isArray(categories)) {
      categoryPages = categories.map((cat: any) => ({
        url: `${baseUrl}/products?category=${cat.slug || cat.id}`,
        lastModified: new Date(cat.updatedAt),
        changeFrequency: 'daily' as const,
        priority: 0.7,
      }));
    }
  } catch {}

  // Fetch products for product detail pages
  let productPages: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(`${apiUrl}/products?isActive=true&perPage=1000`);
    const data = await res.json();
    const products = data.data || [];
    if (Array.isArray(products)) {
      productPages = products.map((p: any) => ({
        url: `${baseUrl}/products/${p.slug}`,
        lastModified: new Date(p.updatedAt),
        changeFrequency: 'daily' as const,
        priority: 0.6,
      }));
    }
  } catch {}

  // Fetch combos for combo detail pages
  let comboPages: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(`${apiUrl}/combos?isActive=true&perPage=1000`);
    const data = await res.json();
    const combos = data.data || [];
    if (Array.isArray(combos)) {
      comboPages = combos.map((c: any) => ({
        url: `${baseUrl}/combos/${c.id}`,
        lastModified: new Date(c.updatedAt),
        changeFrequency: 'daily' as const,
        priority: 0.6,
      }));
    }
  } catch {}

  // Fetch CMS pages
  let cmsPages: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(`${apiUrl}/cms-pages`);
    const data = await res.json();
    const pages = Array.isArray(data) ? data : data.data || [];
    if (Array.isArray(pages)) {
      cmsPages = pages.map((p: any) => ({
        url: `${baseUrl}/pages/${p.slug}`,
        lastModified: new Date(p.updatedAt),
        changeFrequency: 'monthly' as const,
        priority: 0.5,
      }));
    }
  } catch {}

  return [...staticPages, ...categoryPages, ...productPages, ...comboPages, ...cmsPages];
}
