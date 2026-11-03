"use client";

import { useEffect, useState } from 'react';
import type { Product, ProductCardData } from "@/lib/types";
import apiClient from "@/lib/api-client";
import { transformBackendProductCard } from "@/lib/api/products";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
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
  // SSR-provided items (page.tsx fetches these in parallel with the product).
  // When present, the client fetch is skipped — no browser waterfall.
  initialItems?: ProductCardData[];
}

export default function RelatedProducts({ product, initialItems }: Props) {
  const { config } = useStorefrontConfig();
  const hideOos = config.features?.hideOosFromArchive === true;
  const [products, setProducts] = useState<ProductCardData[]>(initialItems ?? []);
  const [loading, setLoading] = useState(!initialItems);

  useEffect(() => {
    if (initialItems) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setLoading(true);
    });

    async function fetch() {
      try {
        const params: Record<string, any> = {
          isActive: true,
          perPage: 20,
          category: product.categorySlug || product.category,
          hasStock: hideOos || undefined,
        };
        const { data } = await apiClient.get('/products', { params: { ...params, fields: 'card' } });
        let list: ProductCardData[] = (data.data || [])
          .filter((p: any) => p.id !== product.id)
          .map(transformBackendProductCard);

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
  }, [product.id, product.category, product.categorySlug, product.tags, initialItems]);

  if (loading || products.length === 0) return null;

  return (
    <div className="border-t border-gray-100 pt-8 mt-8 px-4 min-[901px]:px-6 max-w-screen-xl mx-auto">
      <h2 className="text-[19px] font-medium text-brand-dark m-0 mb-[14px]">You May Also Like</h2>

      {/* P2 DOM slimming: previously this list rendered TWICE — a mobile
          scroll row AND a desktop grid, both fully in the DOM (CSS-hidden
          duplicate). One responsive container now: horizontal scroll row
          below 901px, 4-column grid at/above it — same visuals, half the
          card DOM (each card subtree is ~40+ nodes). */}
      <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2 -mx-4 px-4 min-[901px]:grid min-[901px]:grid-cols-4 min-[901px]:gap-4 min-[901px]:overflow-visible min-[901px]:pb-0 min-[901px]:mx-0 min-[901px]:px-0">
        {products.map((p) => (
          <div key={p.id} className="flex-shrink-0 w-[160px] min-[901px]:w-auto">
            <ProductCard product={p} />
          </div>
        ))}
      </div>
    </div>
  );
}
