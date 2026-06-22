"use client";

import { useMemo, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { PLACEHOLDER_IMAGE } from "@/lib/constants";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { VariantPickerModal } from "@/components/VariantPickerModal";
import type { Product, Variant } from "@/lib/types";

const COLOR_KEYWORDS = ['color', 'colour', 'clr', 'কালার', 'কালার্', 'রং', 'রঙ', 'ক্‌লার'];

function isColorAttr(name: string): boolean {
  return COLOR_KEYWORDS.some(k => name.toLowerCase().includes(k));
}

function getColorValue(value: string): string {
  const colorMap: Record<string, string> = {
    'red': '#EF4444', 'green': '#22C55E', 'blue': '#3B82F6', 'black': '#000000',
    'white': '#FFFFFF', 'gray': '#6B7280', 'grey': '#6B7280', 'navy': '#1E3A5F',
    'pink': '#EC4899', 'purple': '#A855F7', 'yellow': '#EAB308', 'orange': '#F97316',
    'brown': '#78350F', 'teal': '#0D9488', 'maroon': '#800000', 'cream': '#FFFDD0',
    'beige': '#F5F5DC', 'khaki': '#C3B091', 'olive': '#808000', 'wine': '#722F37',
    'gold': '#FFD700', 'silver': '#C0C0C0', 'sky': '#87CEEB', 'coral': '#FF7F50',
  };
  return colorMap[value.toLowerCase().trim()] || '#CBD5E1';
}

interface ColorEntry {
  colorValue: string;
  variant: Variant;
  hasStock: boolean;
}

function buildColorEntries(variants: Variant[]): ColorEntry[] {
  const seen = new Set<string>();
  const entries: ColorEntry[] = [];

  for (const v of variants) {
    if (!v.isActive) continue;
    const colorAV = v.attributeValues.find(av =>
      isColorAttr(av.attributeValue.attribute.name)
    );
    if (!colorAV) continue;
    const val = colorAV.attributeValue.value;
    if (seen.has(val)) continue;
    seen.add(val);
    entries.push({
      colorValue: val,
      variant: v,
      hasStock: v.stock > 0,
    });
  }
  return entries;
}

function getBestImage(product: Product, variant: Variant): string {
  return variant.image || product.image || PLACEHOLDER_IMAGE;
}

function findColorAttrName(variants: Variant[]): string | null {
  for (const v of variants) {
    for (const av of v.attributeValues) {
      const n = av.attributeValue.attribute.name.toLowerCase();
      if (COLOR_KEYWORDS.some(k => n.includes(k))) {
        return av.attributeValue.attribute.name;
      }
    }
  }
  return null;
}

interface Props {
  product: Product;
}

export default function ColorCatalogGrid({ product }: Props) {
  const { config } = useStorefrontConfig();
  const variants = product.variants || [];
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [modalColor, setModalColor] = useState<string | null>(null);

  const colorEntries = useMemo(() => buildColorEntries(variants), [variants]);
  const colorAttrName = useMemo(() => findColorAttrName(variants), [variants]);

  const handleAddToCart = useCallback((e: React.MouseEvent, colorValue: string) => {
    e.preventDefault();
    e.stopPropagation();
    setModalColor(colorValue);
  }, []);

  if (colorEntries.length === 0) {
    return (
      <div className="max-w-screen-xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500 text-[15px]">No color variants available for this product.</p>
        <Link href={`/products/${product.slug}`} className="mt-4 inline-block text-brand-blue font-medium hover:underline">
          View Product Details
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[14px] text-gray-500 mb-6">
        <Link href="/" className="hover:text-gray-800 transition-colors">Home</Link>
        <span className="text-gray-300">/</span>
        <Link href="/products" className="hover:text-gray-800 transition-colors">Products</Link>
        <span className="text-gray-300">/</span>
        <Link href={`/products/${product.slug}`} className="hover:text-gray-800 transition-colors">{product.name}</Link>
        <span className="text-gray-300">/</span>
        <span className="text-gray-800 font-medium">Colors</span>
      </div>

      <h1 className="text-[22px] md:text-[28px] font-semibold text-gray-900 mb-2">{product.name}</h1>
      <p className="text-[14px] text-gray-500 mb-8">Available in {colorEntries.length} colors</p>

      {/* Color Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-5">
        {colorEntries.map((entry) => {
          const imgSrc = imgErrors[entry.colorValue]
            ? PLACEHOLDER_IMAGE
            : getBestImage(product, entry.variant);
          const linkUrl = `/products/${product.slug}/colors?color=${encodeURIComponent(entry.colorValue)}`;
          const colorVal = getColorValue(entry.colorValue);

          return (
            <div
              key={entry.colorValue}
              className="bg-white rounded-[8px] border border-gray-200 overflow-hidden flex flex-col group transition-all hover:shadow-lg hover:border-brand-blue/30"
            >
              {/* Image */}
              <Link href={linkUrl} className="relative aspect-square bg-gray-50 overflow-hidden">
                <Image
                  src={imgSrc}
                  alt={`${product.name} - ${entry.colorValue}`}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
                  className="object-contain p-2 transition-transform duration-500 group-hover:scale-105"
                  onError={() => setImgErrors(prev => ({ ...prev, [entry.colorValue]: true }))}
                />
                {!entry.hasStock && (
                  <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                    <span className="bg-gray-900/80 text-white text-[11px] font-bold px-3 py-1 rounded-full">
                      Out of Stock
                    </span>
                  </div>
                )}
              </Link>

              {/* Info */}
              <div className="p-2 md:p-3 flex flex-col flex-1">
                {/* Color swatch + name */}
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="w-4 h-4 rounded-full ring-1 ring-gray-300 flex-shrink-0"
                    style={{ backgroundColor: colorVal }}
                  />
                  <span className="text-[12px] font-medium text-gray-800">{entry.colorValue}</span>
                </div>

                {/* Price */}
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-[15px] font-bold text-brand-blue">
                    {config.currency.symbol}{(entry.variant.price || product.price).toLocaleString()}
                  </span>
                  {product.originalPrice && product.originalPrice > (entry.variant.price || product.price) && (
                    <span className="text-[12px] text-gray-300 line-through">
                      {config.currency.symbol}{product.originalPrice.toLocaleString()}
                    </span>
                  )}
                </div>

                {/* CTA — matches normal product card style */}
                <button
                  onClick={(e) => handleAddToCart(e, entry.colorValue)}
                  disabled={!entry.hasStock}
                  className="mt-auto w-full h-[34px] md:h-[40px] bg-white text-brand-blue font-bold text-[12px] md:text-[13px] border-2 border-brand-blue/20 rounded-lg flex items-center justify-center gap-2 hover:bg-brand-blue hover:text-white hover:border-brand-blue transition-all"
                >
                  <ShoppingCart size={16} strokeWidth={2.5} />
                  {entry.hasStock ? 'ADD TO CART' : 'OUT OF STOCK'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Variant picker modal — opens with color pre-selected */}
      <VariantPickerModal
        product={product}
        open={!!modalColor}
        onClose={() => setModalColor(null)}
        initialAttrs={modalColor && colorAttrName ? { [colorAttrName]: modalColor } : undefined}
      />
    </div>
  );
}
