import { Fragment, Suspense } from 'react';
import type { ProductCardData } from "@/lib/types";
import Hero from "@/components/Hero";
import CategoryList from "@/components/CategoryList";
import ProductSection from "@/components/ProductSection";
import ProductSectionSkeleton from "@/components/ProductSectionSkeleton";
import BrandSection from "@/components/BrandSection";
import ComboDeals from "@/components/ComboDeals";
import Testimonials from "@/components/Testimonials";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import { getFeaturedProductsServer, getNewArrivalsServer, getPopularItemsServer, getBrandsServer, fetchProductCardsServer, getCategoriesServer } from "@/lib/api/products-server";

// P2 (speed plan §5): this page used to be `force-dynamic` because
// "sections render stock indicators via revalidate:0 fetches". That
// premise is stale: every fetcher below goes through products-server,
// whose serverFetch calls carry `revalidate: 60` (a revalidate:0 fetch
// on a prerendered page is what actually threw DYNAMIC_SERVER_USAGE).
// Stock badges therefore read the same 60s data cache the PDP relies
// on, and checkout re-validates stock server-side — so the page is
// classic ISR: prerendered shell, regenerated at most every 60s.
// Cache Components / PPR was NOT adopted for this (Next 16.4 bundled
// docs: enabling `cacheComponents` replaces route-segment `revalidate`
// app-wide and errors on routes still exporting it — a whole-app
// migration, not a per-page switch).
export const revalidate = 60;

type SectionData = { title: string; products: ProductCardData[]; href: string } | null;

async function fetchSectionProducts(sec: any, config: any): Promise<SectionData> {
  try {
    let products: ProductCardData[] = [];
    let href = '/products';
    const limit = sec.limit || 4;
    if (sec.type === 'featured') {
      products = await getFeaturedProductsServer(limit);
    } else if (sec.type === 'new_arrivals') {
      products = await getNewArrivalsServer(limit);
      href = '/products?sort=newest';
    } else if (sec.type === 'popular') {
      products = await getPopularItemsServer(limit);
      href = '/products?sort=popularity';
    } else if (sec.type === 'category' && sec.categoryId) {
      const allCats = await getCategoriesServer();
      const cat = allCats.find((c: any) => c.id === sec.categoryId);
      href = cat?.slug ? `/products?category=${cat.slug}` : `/products?categoryId=${sec.categoryId}`;
      let sort: string | undefined;
      let order: string | undefined;
      if (sec.categorySort === 'new_arrivals') {
        sort = 'createdAt';
        order = 'desc';
      } else if (sec.categorySort === 'popular') {
        sort = 'popularity';
        order = 'desc';
      }
      const hideOos = config?.features?.hideOosFromArchive === true;
      const res = await fetchProductCardsServer({
        categoryId: sec.categoryId,
        isActive: true,
        perPage: limit,
        sort,
        order,
        hasStock: hideOos || undefined,
      });
      products = res.data;
    }
    return { title: sec.title, products, href };
  } catch (e) {
    console.error(`Failed to fetch products for section ${sec.title}:`, e);
    return null;
  }
}

/** One homepage product section, streamed in behind its own Suspense boundary. */
async function HomeSection({ sec, config, prioritizeFirstCards = false }: { sec: any; config: any; prioritizeFirstCards?: boolean }) {
  const data = await fetchSectionProducts(sec, config);
  if (!data) return null;
  return <ProductSection title={data.title} products={data.products} href={data.href} prioritizeFirstCards={prioritizeFirstCards} />;
}

async function HomeBrands() {
  const brands = await getBrandsServer().catch(() => [] as any[]);
  return <BrandSection brands={brands} />;
}

export default async function HomePage() {
  const config = await getStorefrontConfigServer().catch(() => null);
  const sections = config?.homepageSections || [
    { id: '1', title: 'Featured Gadgets', type: 'featured', limit: 4, enabled: true },
    { id: '2', title: 'New Arrivals', type: 'new_arrivals', limit: 4, enabled: true },
    { id: '3', title: 'Popular Items', type: 'popular', limit: 4, enabled: true },
  ];
  // Enabled sections are known synchronously from config. Pre-P2 the
  // Brand/Combo interleave position was computed over sections whose
  // FETCH succeeded; with streaming, position follows the enabled list
  // (a failed section renders nothing but no longer shifts Brand/Combo
  // down — the only behavioral delta, and only on a fetch-failure path).
  const enabledSections = sections.filter((sec: any) => sec.enabled);
  const hasHeroSlides = (config?.hero?.slides?.length ?? 0) > 0;

  return (
    <>
      {/* Single h1 for the homepage (screen-reader only — zero visual change). */}
      <h1 className="sr-only">
        {config?.store?.name || 'EcoMate'}
        {config?.store?.tagline ? ` — ${config.store.tagline}` : ''}
      </h1>
      <Hero
        slides={config?.hero?.slides || []}
        secondaryBanner={config?.hero?.secondaryBanner}
        secondaryBannerAlt={config?.hero?.secondaryBannerAlt}
        mediaMeta={config?._mediaMeta}
      />
      <CategoryList />

      {enabledSections.map((sec: any, idx: number) => (
        <Fragment key={sec.title + idx}>
          <Suspense fallback={<ProductSectionSkeleton cards={sec.limit || 4} />}>
            {/* Card-image priority only when this first section is the
                LCP zone — i.e. the hero above it has no slides. With a
                hero present, its image owns the priority budget. */}
            <HomeSection
              sec={sec}
              config={config}
              prioritizeFirstCards={idx === 0 && !hasHeroSlides}
            />
          </Suspense>
          {idx === 0 && (
            <Suspense fallback={null}>
              <HomeBrands />
            </Suspense>
          )}
          {idx === 1 && <ComboDeals />}
        </Fragment>
      ))}

      {enabledSections.length < 1 && (
        <Suspense fallback={null}>
          <HomeBrands />
        </Suspense>
      )}
      {enabledSections.length < 2 && <ComboDeals />}

      <Suspense fallback={null}>
        <Testimonials />
      </Suspense>
    </>
  );
}
