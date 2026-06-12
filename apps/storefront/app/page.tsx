import type { Product } from "@/lib/types";
import Hero from "../components/Hero";
import CategoryList from "../components/CategoryList";
import ProductSection from "../components/ProductSection";
import BrandSection from "../components/BrandSection";
import ComboDeals from "../components/ComboDeals";
import Testimonials from "../components/Testimonials";
import { getFeaturedProductsServer, getNewArrivalsServer, getPopularItemsServer } from "@/lib/api/products-server";

export const revalidate = 300;

export default async function HomePage() {
  let featured: Product[] = [];
  let newArrivals: Product[] = [];
  let popular: Product[] = [];

  try {
    const results = await Promise.all([
      getFeaturedProductsServer(),
      getNewArrivalsServer(),
      getPopularItemsServer(),
    ]);
    featured = results[0];
    newArrivals = results[1];
    popular = results[2];
  } catch (error) {
    console.error('Homepage data fetch failed:', error);
  }

  return (
    <>
      <Hero />
      <CategoryList />
      <ProductSection title="Featured Gadgets" products={featured.slice(0, 4)} />
      <BrandSection />
      <ProductSection title="New Arrivals" products={newArrivals.slice(0, 4)} />
      <ComboDeals />
      <ProductSection title="Popular Items" products={popular.slice(0, 4)} />
      <Testimonials />
    </>
  );
}
