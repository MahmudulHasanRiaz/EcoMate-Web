"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import { ShoppingCart, X } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { PLACEHOLDER_IMAGE } from "@/lib/constants";
import { trackEvent } from "@/lib/tracking";
import type { Product, Variant } from "@/lib/types";
import { toast } from "sonner";

const SIZE_ORDER: Record<string, number> = {
  'S': 0, 'M': 1, 'L': 2, 'XL': 3, 'XXL': 4, 'XXXL': 5,
  's': 0, 'm': 1, 'l': 2, 'xl': 3, 'xxl': 4, 'xxxl': 5,
  'এস': 0, 'এম': 1, 'এল': 2, 'এক্সএল': 3, 'ডাব্লিউএক্সএল': 4,
};

const COLOR_KEYWORDS = ['color', 'colour', 'রং', 'কালার', 'ক্‌লার'];
const SIZE_KEYWORDS = ['size', 'সাইজ', 'আকার', 'মাপ'];

function sortValues(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const aIdx = SIZE_ORDER[a] ?? 999;
    const bIdx = SIZE_ORDER[b] ?? 999;
    if (aIdx !== 999 || bIdx !== 999) return aIdx - bIdx;
    return a.localeCompare(b);
  });
}

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
  return colorMap[value.toLowerCase().trim()] || value;
}

function buildAttributeGroups(variants: Variant[]): Record<string, { value: string }[]> {
  const groups: Record<string, { value: string }[]> = {};
  for (const v of variants) {
    if (!v.isActive) continue;
    for (const av of v.attributeValues) {
      const attr = av.attributeValue.attribute;
      if (!groups[attr.name]) groups[attr.name] = [];
      if (!groups[attr.name].some((g) => g.value === av.attributeValue.value)) {
        groups[attr.name].push({ value: av.attributeValue.value });
      }
    }
  }
  for (const name of Object.keys(groups)) {
    groups[name] = sortValues(groups[name].map(g => g.value)).map(v => ({ value: v }));
  }
  return groups;
}

function findMatchingVariant(variants: Variant[], selected: Record<string, string>): Variant | null {
  if (Object.keys(selected).length === 0) return null;
  return variants.find(v => {
    if (!v.isActive) return false;
    return Object.entries(selected).every(([attrName, value]) =>
      v.attributeValues.some(av =>
        av.attributeValue.attribute.name === attrName && av.attributeValue.value === value
      )
    );
  }) || null;
}

interface Props {
  product: Product;
  open: boolean;
  onClose: () => void;
  flyTarget?: { x: number; y: number };
}

export function VariantPickerModal({ product, open, onClose, flyTarget }: Props) {
  const { addToCart, setIsCartOpen } = useCart();
  const { config } = useStorefrontConfig();
  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string>>({});
  const [imageError, setImageError] = useState(false);

  const variants = product.variants || [];
  const attributeGroups = useMemo(() => buildAttributeGroups(variants), [variants]);
  const attrNames = Object.keys(attributeGroups);

  const matchingVariant = useMemo(() => findMatchingVariant(variants, selectedAttrs), [variants, selectedAttrs]);

  const handleSelect = (attrName: string, value: string) => {
    setSelectedAttrs(prev => ({ ...prev, [attrName]: value }));
  };

  const isAllSelected = attrNames.length > 0 && attrNames.every(name => selectedAttrs[name]);

  const handleAdd = () => {
    if (!matchingVariant) {
      const missingAttrs = attrNames.filter(name => !selectedAttrs[name]);
      if (missingAttrs.length > 0) {
        const missingMsg = missingAttrs.map(name => {
          if (COLOR_KEYWORDS.some(k => name.toLowerCase().includes(k))) return 'কালার';
          if (SIZE_KEYWORDS.some(k => name.toLowerCase().includes(k))) return 'সাইজ';
          return name;
        }).join(' ও ');
        toast.error(`${missingMsg} সিলেক্ট করুন`);
      }
      return;
    }
    if (matchingVariant.stock <= 0) return;
    const variantLabel = matchingVariant.attributeValues
      .map(av => `${av.attributeValue.attribute.name}: ${av.attributeValue.value}`)
      .join(', ');
    const variantAttrs = matchingVariant.attributeValues.map(av => ({
      name: av.attributeValue.attribute.name,
      value: av.attributeValue.value,
    }));

    const img = document.getElementById(`variant-modal-img`);
    if (img) {
      const rect = img.getBoundingClientRect();
      window.dispatchEvent(new CustomEvent('fly-to-cart', {
        detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, image: imageError ? PLACEHOLDER_IMAGE : matchingVariant.image || product.image }
      }));
    } else if (flyTarget) {
      window.dispatchEvent(new CustomEvent('fly-to-cart', {
        detail: { x: flyTarget.x, y: flyTarget.y, image: imageError ? PLACEHOLDER_IMAGE : matchingVariant.image || product.image }
      }));
    }

    trackEvent('AddToCart', {
      content_ids: [matchingVariant.id || product.id],
      value: matchingVariant.price,
      currency: config.currency.code,
      contents: [{ id: matchingVariant.id || product.id, quantity: 1, item_price: matchingVariant.price, variant: variantLabel }],
    });

    addToCart({
      id: product.id,
      variantId: matchingVariant.id,
      variantLabel,
      variantAttributes: variantAttrs,
      name: `${product.name} - ${variantLabel}`,
      price: matchingVariant.price,
      originalPrice: matchingVariant.price < product.price ? product.price : undefined,
      image: matchingVariant.image || product.image,
      quantity: 1,
      slug: product.slug,
    });

    onClose();
    setIsCartOpen(true);
  };

  const displayPrice = matchingVariant?.price ?? product.price;
  const displayImg = imageError || !(matchingVariant?.image || product.image) ? PLACEHOLDER_IMAGE : (matchingVariant?.image || product.image);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto z-10 mx-4 animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center z-10 hover:bg-gray-200 transition-colors"
        >
          <X size={16} />
        </button>

        <div className="p-5">
          <div className="flex gap-4 mb-5">
            <div className="w-24 h-24 rounded-lg overflow-hidden bg-gray-50 shrink-0 relative">
              <Image
                id="variant-modal-img"
                src={displayImg}
                alt={product.name}
                fill
                className="object-contain"
                sizes="96px"
                onError={() => setImageError(true)}
              />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 leading-tight">{product.name}</h3>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-lg font-black text-brand-blue">{config.currency.symbol}{displayPrice.toLocaleString()}</span>
                {matchingVariant && matchingVariant.price < product.price && (
                  <span className="text-sm text-gray-300 line-through">{config.currency.symbol}{product.price.toLocaleString()}</span>
                )}
              </div>
              {matchingVariant && matchingVariant.stock > 0 && matchingVariant.stock <= 10 && (
                <p className="text-xs text-amber-600 mt-1">Only {matchingVariant.stock} left!</p>
              )}
              {matchingVariant && matchingVariant.stock <= 0 && (
                <p className="text-xs text-red-500 mt-1">Out of stock</p>
              )}
            </div>
          </div>

          {attrNames.length > 0 && (
            <div className="space-y-3 mb-5">
              {attrNames.map((name) => {
                const isColor = isColorAttr(name);
                return (
                  <div key={name}>
                    <p className="text-xs font-medium text-gray-700 mb-1.5">{name}: <span className="text-gray-400">{selectedAttrs[name] || 'Select'}</span></p>
                    <div className="flex flex-wrap gap-1.5">
                      {attributeGroups[name].map(({ value }) => {
                        const isActive = variants.some(v => v.isActive && v.attributeValues.some(av => av.attributeValue.attribute.name === name && av.attributeValue.value === value));
                        const selected = selectedAttrs[name] === value;

                        if (isColor) {
                          const colorVal = getColorValue(value);
                          return (
                            <button
                              key={value}
                              onClick={() => handleSelect(name, value)}
                              disabled={!isActive}
                              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                                selected ? 'ring-2 ring-brand-blue ring-offset-1 scale-110' : 'ring-1 ring-gray-300 hover:ring-gray-400'
                              } ${!isActive ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                              style={{ backgroundColor: colorVal }}
                              title={value}
                              aria-label={value}
                            />
                          );
                        }

                        return (
                          <button
                            key={value}
                            onClick={() => handleSelect(name, value)}
                            disabled={!isActive}
                            className={`h-9 min-w-[40px] px-3 text-xs rounded-md border transition-colors ${
                              selected
                                ? 'bg-brand-blue text-white border-brand-blue font-medium'
                                : isActive
                                  ? 'bg-white text-gray-800 border-gray-300 hover:border-brand-blue'
                                  : 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed'
                            }`}
                          >
                            {value}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <button
            onClick={handleAdd}
            disabled={matchingVariant ? matchingVariant.stock <= 0 : false}
            className="w-full h-11 bg-brand-blue text-white font-bold text-sm rounded-lg flex items-center justify-center gap-2 hover:bg-brand-blue/90 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-all"
          >
            <ShoppingCart size={18} strokeWidth={2.5} />
            {matchingVariant && matchingVariant.stock <= 0 ? 'Out of Stock'
              : isAllSelected || attrNames.length === 0 ? 'ADD TO CART'
              : 'Select ' + attrNames.filter(n => !selectedAttrs[n]).join(' & ') + '...'}
          </button>
        </div>
      </div>
    </div>
  );
}
