"use client";

import { useEffect, useState } from 'react';
import type { Product } from "@/lib/types";
import apiClient from "@/lib/api-client";
import { transformBackendProduct } from "@/lib/api/products";
import ProductCard from "./ProductCard";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Props {
  product: Product;
}

export default function RelatedProducts({ product }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function fetch() {
      try {
        const params: Record<string, any> = {
          isActive: true,
          perPage: 20,
          category: product.categorySlug || product.category,
        };
        const { data } = await apiClient.get('/products', { params });
        let list: Product[] = (data.data || [])
          .filter((p: any) => p.id !== product.id)
          .map(transformBackendProduct);

        const productTags = product.tags || [];
        if (productTags.length > 0) {
          const tagged = list.filter((p: any) =>
            p.tags?.some((t: string) => productTags.includes(t))
          );
          const untagged = list.filter((p: any) =>
            !p.tags?.some((t: string) => productTags.includes(t))
          );
          list = [...shuffleArray(tagged), ...shuffleArray(untagged)];
        } else {
          list = shuffleArray(list);
        }

        list = list.slice(0, 8);

        if (!cancelled) setProducts(list);
      } catch {
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch();
    return () => { cancelled = true; };
  }, [product.id, product.category, product.categorySlug, product.tags]);

  if (loading || products.length === 0) return null;

  return (
    <div className="border-t border-gray-100 pt-8 mt-8 px-4 max-w-screen-xl mx-auto">
      <h3 className="text-[16px] font-semibold text-gray-800 mb-4">আরো দেখুন</h3>

      <div className="flex gap-3 overflow-x-auto hide-scrollbar md:hidden pb-2 -mx-4 px-4">
        {products.map((p) => (
          <div key={p.id} className="flex-shrink-0 w-[160px]">
            <ProductCard product={p} />
          </div>
        ))}
      </div>

      <div className="hidden md:grid md:grid-cols-4 gap-4">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </div>
  );
}
