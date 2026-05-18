"use client";

import { useEffect, useState } from "react";
import Hero from "../components/Hero";
import CategoryList from "../components/CategoryList";
import ProductSection from "../components/ProductSection";
import BrandSection from "../components/BrandSection";
import ComboDeals from "../components/ComboDeals";
import Testimonials from "../components/Testimonials";
import { getProducts } from "@/lib/api/products";
import type { Product } from "@/lib/types";

export default function HomePage() {
  const [featured, setFeatured] = useState<Product[]>([]);
  const [firstCategoryProducts, setFirstCategoryProducts] = useState<Product[]>([]);
  const [secondCategoryProducts, setSecondCategoryProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getProducts({ isActive: true, isFeatured: true, perPage: 4 }),
      getProducts({ isActive: true, perPage: 4, sort: 'createdAt', order: 'desc' }),
    ])
      .then(([featuredRes, latestRes]) => {
        setFeatured(featuredRes.data);
        setFirstCategoryProducts(featuredRes.data.slice(0, 4));
        setSecondCategoryProducts(latestRes.data.slice(0, 4));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Hero />
      <CategoryList />
      <ProductSection title="Featured Gadgets" products={featured.slice(0, 4)} />
      <BrandSection />
      <ProductSection title="Repair Services" products={firstCategoryProducts} />
      <ComboDeals />
      <ProductSection title="Essential Accessories" products={secondCategoryProducts} />
      <Testimonials />
    </>
  );
}
