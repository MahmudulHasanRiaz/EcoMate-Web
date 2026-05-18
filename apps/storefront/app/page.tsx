import Hero from "../components/Hero";
import CategoryList from "../components/CategoryList";
import ProductSection from "../components/ProductSection";
import BrandSection from "../components/BrandSection";
import ComboDeals from "../components/ComboDeals";
import Testimonials from "../components/Testimonials";
import { PRODUCTS } from "@/lib/constants";

export default function HomePage() {
  return (
    <>
      <Hero />
      <CategoryList />
      <ProductSection title="Featured Gadgets" products={PRODUCTS.slice(0, 4)} />
      <BrandSection />
      <ProductSection title="Repair Services" products={PRODUCTS.filter(p => p.category === 'repair').slice(0, 4)} />
      <ComboDeals />
      <ProductSection title="Essential Accessories" products={PRODUCTS.filter(p => p.category === 'accessories').slice(0, 4)} />
      <Testimonials />
    </>
  );
}
