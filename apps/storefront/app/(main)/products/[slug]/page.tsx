import type { Metadata } from "next";
import Link from "next/link";
import type { Product } from "@/lib/types";
import {
  getBackendStatusServer,
  getProductBySlugServer,
  getRelatedProductsServer,
  getReviewsServer,
  getSizeChartPresenceServer,
  getTopProductSlugsServer,
} from "@/lib/api/products-server";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import { hasLicenseFeature } from "@/lib/api/storefront-config";
import { toMetaDescription } from "@/lib/strip-html";
import { sanitizeProductHTML } from "@/lib/sanitize-product";
import { publicMediaUrl, siteUrl } from "@/lib/site-url";
import ProductDetailClient from "@/components/ProductDetailClient";

// Surge-ready caching: the PDP shell (product core, related, reviews,
// sanitized HTML) is served from the render cache for 60s, so a traffic
// spike costs ~1 backend product read per slug per minute instead of one per
// view. Stock/price staleness is bounded by this same 60s window (plus the
// backend's own 10s product-cache TTL); checkout re-validates stock
// server-side, so an oversell can never slip through a stale shell.
export const revalidate = 60;
export const dynamicParams = true;

// Prerender the best sellers at build time; everything else renders on
// demand and joins the 60s cache. Build-safe: an unreachable backend yields
// [] instead of failing `next build`.
export async function generateStaticParams() {
  const slugs = await getTopProductSlugsServer(200);
  return slugs.map((slug) => ({ slug }));
}

// Absolute, crawler-safe product image URL shared by OG/Twitter meta and
// JSON-LD. Internal backend origins (http://backend:4000, localhost) are
// rewritten to the public site origin — see publicMediaUrl.
function ogImageAbsolute(product: Product): string | undefined {
  return publicMediaUrl(product.image);
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  let storeName = "Store";
  try { const c = await getStorefrontConfigServer(); storeName = c.store.name; } catch {}
  try {
    // Shared request-memoized fetch with the page below — one backend hit.
    const product = await getProductBySlugServer(slug);
    if (!product) {
      // A missing product during a backend outage must not wear a 404 title.
      const backendUp = await getBackendStatusServer();
      return backendUp
        ? { title: "Product Not Found" }
        : { title: "Service Unavailable", robots: { index: false, follow: false } };
    }
    const url = `${siteUrl()}/products/${slug}`;
    // NOTE: title is the bare product name — the root layout template
    // (`%s — Store`) appends the store name exactly once.
    // Prefer plain-text shortDesc; otherwise strip HTML from description so
    // meta/OG/Twitter never contain tags or mid-word cuts.
    const description = product.shortDesc
      ? product.shortDesc
      : toMetaDescription(product.description, `${product.name} at ${storeName}`);
    const ogImage = ogImageAbsolute(product);
    return {
      title: product.name,
      description,
      alternates: { canonical: url },
      openGraph: {
        title: product.name,
        description,
        url,
        siteName: storeName,
        images: ogImage ? [{ url: ogImage }] : [],
      },
      twitter: {
        card: "summary_large_image",
        title: product.name,
        description,
        images: ogImage ? [ogImage] : [],
      },
    };
  } catch {
    return { title: "Product Not Found" };
  }
}

function ProductNotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <h1 className="text-4xl font-bold text-gray-900 mb-4">Product Not Found</h1>
      <p className="text-gray-600 mb-8 max-w-md">
        This product may have been removed or is no longer available.
      </p>
      <Link
        href="/products"
        className="inline-flex items-center px-6 py-3 bg-brand-blue text-white rounded-xl hover:bg-brand-blue-dark transition-colors"
      >
        Browse Products
      </Link>
    </div>
  );
}

function ProductUnavailable() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <h1 className="text-4xl font-bold text-gray-900 mb-4">Something went wrong</h1>
      <p className="text-gray-600 mb-8 max-w-md">
        We couldn&apos;t load this product right now. Please try again in a moment.
      </p>
      <div className="flex items-center gap-3">
        <a
          href=""
          className="inline-flex items-center px-6 py-3 bg-brand-blue text-white rounded-xl hover:bg-brand-blue-dark transition-colors"
        >
          Try Again
        </a>
        <Link
          href="/products"
          className="inline-flex items-center px-6 py-3 border border-gray-200 text-gray-700 rounded-xl hover:border-gray-300 transition-colors"
        >
          Browse Products
        </Link>
      </div>
    </div>
  );
}

export default async function ProductPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  try {
    // generateMetadata above already fetched this slug in the same request —
    // React cache() dedupes it to a single backend hit.
    const product = await getProductBySlugServer(slug);
    if (!product) {
      // Outage ≠ 404: only show "Not Found" when the backend is reachable.
      const backendUp = await getBackendStatusServer();
      return backendUp ? <ProductNotFound /> : <ProductUnavailable />;
    }
    // Related items + reviews + size-chart presence resolve server-side in
    // parallel: zero browser `/api/*` calls on PDP load.
    // Size-guide trigger visibility comes from actual assignment (endpoint
    // truthiness), NOT the bare feature flag — otherwise every PDP shows a
    // guide button for charts that don't exist (Fix 2).
    let sizeChartFlag = false;
    try {
      sizeChartFlag = !!(await getStorefrontConfigServer()).features?.sizeChart;
    } catch {}
    const [relatedItems, initialReviews, hasSizeChart] = await Promise.all([
      getRelatedProductsServer(product),
      getReviewsServer(slug),
      sizeChartFlag ? getSizeChartPresenceServer(slug) : Promise.resolve(false),
    ]);
    // Sanitize on the server: the HTML arrives pre-cleaned as props, so
    // isomorphic-dompurify never enters the PDP client bundle.
    const sanitizedDescription = sanitizeProductHTML(product.description || '');
    const sanitizedSpecifications = sanitizeProductHTML(product.descriptionSections?.specifications || '');
    const pageUrl = `${siteUrl()}/products/${slug}`;
    // AggregateRating only when ratings actually exist AND the reviews UI is
    // visible — otherwise search engines flag it as invalid markup.
    let reviewsVisible = true;
    try {
      reviewsVisible = (await getStorefrontConfigServer()).features?.showReviews !== false;
    } catch {}
    // Customization section gate (license feature 'product-customization').
    let customizationEnabled = false;
    try {
      const cfg = await getStorefrontConfigServer();
      customizationEnabled = hasLicenseFeature(cfg as any, 'product-customization');
    } catch {}
    const ratingValue = product.averageRating || product.rating || 0;
    const reviewCount = product.reviewCount || 0;
    const productJsonLd: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description: product.shortDesc
        ? product.shortDesc
        : toMetaDescription(product.description, product.name),
      image: ogImageAbsolute(product) || undefined,
      ...(product.sku ? { sku: product.sku } : {}),
      ...(product.brand?.name ? { brand: { '@type': 'Brand', name: product.brand.name } } : {}),
      offers: {
        '@type': 'Offer',
        url: pageUrl,
        price: product.price,
        priceCurrency: 'BDT',
        availability: product.stock && product.stock > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      },
      ...(reviewsVisible && reviewCount > 0 && ratingValue > 0
        ? { aggregateRating: { '@type': 'AggregateRating', ratingValue, reviewCount } }
        : {}),
    };
    const breadcrumbJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl()}/` },
        ...(product.category
          ? [{
              '@type': 'ListItem',
              position: 2,
              name: product.category,
              item: product.categorySlug
                ? `${siteUrl()}/category/${product.categorySlug}`
                : `${siteUrl()}/products`,
            }]
          : []),
        { '@type': 'ListItem', position: product.category ? 3 : 2, name: product.name, item: pageUrl },
      ],
    };
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
        />
        <ProductDetailClient product={product} initialRelatedItems={relatedItems} initialReviews={initialReviews} sanitizedDescription={sanitizedDescription} sanitizedSpecifications={sanitizedSpecifications} sizeGuideAvailable={hasSizeChart} customizationEnabled={customizationEnabled} />
      </>
    );
  } catch {
    return <ProductUnavailable />;
  }
}
