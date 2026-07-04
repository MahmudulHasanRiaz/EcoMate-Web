import { Fragment } from 'react';
import type { Product } from "@/lib/types";
import Hero from "@/components/Hero";
import CategoryList from "@/components/CategoryList";
import ProductSection from "@/components/ProductSection";
import BrandSection from "@/components/BrandSection";
import ComboDeals from "@/components/ComboDeals";
import Testimonials from "@/components/Testimonials";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import { getFeaturedProductsServer, getNewArrivalsServer, getPopularItemsServer, getBrandsServer, fetchProductsServer } from "@/lib/api/products-server";

export const revalidate = 300;

export default async function HomePage() {
  const config = await getStorefrontConfigServer();
  const sections = config.homepageSections || [
    { id: '1', title: 'Featured Gadgets', type: 'featured', limit: 4, enabled: true },
    { id: '2', title: 'New Arrivals', type: 'new_arrivals', limit: 4, enabled: true },
    { id: '3', title: 'Popular Items', type: 'popular', limit: 4, enabled: true },
  ];

  let brands: any[] = [];
  try {
    brands = await getBrandsServer();
  } catch (error) {
    console.error('Brands fetch failed:', error);
  }

  const fetchSectionProducts = async (sec: any): Promise<{ title: string; products: Product[]; href: string } | null> => {
    if (!sec.enabled) return null;
    try {
      let products: Product[] = [];
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
        href = `/products?categoryId=${sec.categoryId}`;
        let sort: string | undefined;
        let order: string | undefined;
        if (sec.categorySort === 'new_arrivals') {
          sort = 'createdAt';
          order = 'desc';
        } else if (sec.categorySort === 'popular') {
          sort = 'popularity';
          order = 'desc';
        }
        const res = await fetchProductsServer({
          categoryId: sec.categoryId,
          isActive: true,
          perPage: limit,
          sort,
          order,
        });
        products = res.data;
      }
      return { title: sec.title, products, href };
    } catch (e) {
      console.error(`Failed to fetch products for section ${sec.title}:`, e);
      return null;
    }
  };

  const renderedSectionsData = await Promise.all(
    sections.map(sec => fetchSectionProducts(sec))
  );
  const activeSections = renderedSectionsData.filter(Boolean) as { title: string; products: Product[]; href: string }[];

  return (
    <>
      <Hero
        slides={config.hero.slides}
        secondaryBanner={config.hero.secondaryBanner}
        secondaryBannerAlt={config.hero.secondaryBannerAlt}
      />
      <CategoryList />
      
      {activeSections.map((sec, idx) => (
        <Fragment key={sec.title + idx}>
          <ProductSection title={sec.title} products={sec.products} href={sec.href} />
          {idx === 0 && <BrandSection brands={brands} />}
          {idx === 1 && <ComboDeals />}
        </Fragment>
      ))}

      {activeSections.length < 1 && <BrandSection brands={brands} />}
      {activeSections.length < 2 && <ComboDeals />}

      <Testimonials />
    </>
  );
}
