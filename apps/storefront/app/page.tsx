import { Fragment } from 'react';
import type { Product } from "@/lib/types";
import Hero from "../components/Hero";
import CategoryList from "../components/CategoryList";
import ProductSection from "../components/ProductSection";
import BrandSection from "../components/BrandSection";
import ComboDeals from "../components/ComboDeals";
import Testimonials from "../components/Testimonials";
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

  const fetchSectionProducts = async (sec: any): Promise<{ title: string; products: Product[] } | null> => {
    if (!sec.enabled) return null;
    try {
      let products: Product[] = [];
      const limit = sec.limit || 4;
      if (sec.type === 'featured') {
        products = await getFeaturedProductsServer(limit);
      } else if (sec.type === 'new_arrivals') {
        products = await getNewArrivalsServer(limit);
      } else if (sec.type === 'popular') {
        products = await getPopularItemsServer(limit);
      } else if (sec.type === 'category' && sec.categoryId) {
        const res = await fetchProductsServer({
          categoryId: sec.categoryId,
          isActive: true,
          perPage: limit,
        });
        products = res.data;
      }
      return { title: sec.title, products };
    } catch (e) {
      console.error(`Failed to fetch products for section ${sec.title}:`, e);
      return null;
    }
  };

  const renderedSectionsData = await Promise.all(
    sections.map(sec => fetchSectionProducts(sec))
  );
  const activeSections = renderedSectionsData.filter(Boolean) as { title: string; products: Product[] }[];

  return (
    <>
      <Hero />
      <CategoryList />
      
      {activeSections.map((sec, idx) => (
        <Fragment key={sec.title + idx}>
          <ProductSection title={sec.title} products={sec.products} />
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
