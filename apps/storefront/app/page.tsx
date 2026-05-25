import Hero from "../components/Hero";
import CategoryList from "../components/CategoryList";
import ProductSection from "../components/ProductSection";
import BrandSection from "../components/BrandSection";
import ComboDeals from "../components/ComboDeals";
import Testimonials from "../components/Testimonials";
import { getFeaturedProductsServer } from "@/lib/api/products-server";

export const revalidate = 300;

export default async function HomePage() {
  const featured = await getFeaturedProductsServer();

  return (
    <>
      <Hero />
      <CategoryList />
      <ProductSection title="Featured Gadgets" products={featured.slice(0, 4)} />
      <BrandSection />
      <ProductSection title="New Arrivals" products={featured.slice(0, 4)} />
      <ComboDeals />
      <ProductSection title="Popular Items" products={featured.slice(0, 4)} />
      <Testimonials />
    </>
  );
}
