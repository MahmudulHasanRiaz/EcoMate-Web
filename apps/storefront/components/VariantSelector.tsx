"use client";

import { useMemo } from "react";
import type { Variant } from "@/lib/types";

interface Props {
  variants: Variant[];
  selectedVariant: Variant | null;
  onSelect: (variant: Variant) => void;
  onSelectAttr?: (attrName: string, value: string) => void;
  sizeGuideLabel?: string;
  onSizeGuideClick?: () => void;
}

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

function isSizeAttr(name: string): boolean {
  return SIZE_KEYWORDS.some(k => name.toLowerCase().includes(k));
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

export function VariantSelector({ variants, selectedVariant, onSelect, onSelectAttr, sizeGuideLabel, onSizeGuideClick }: Props) {
  const attributeGroups = useMemo(() => {
    const groups: Record<string, { value: string; variant: Variant }[]> = {};
    for (const v of variants) {
      if (!v.isActive) continue;
      for (const av of v.attributeValues) {
        const attr = av.attributeValue.attribute;
        if (!groups[attr.name]) groups[attr.name] = [];
        if (!groups[attr.name].some((g) => g.value === av.attributeValue.value)) {
          groups[attr.name].push({ value: av.attributeValue.value, variant: v });
        }
      }
    }
    for (const name of Object.keys(groups)) {
      groups[name] = sortValues(groups[name].map(g => g.value))
        .map(v => ({ value: v, variant: groups[name].find(g => g.value === v)!.variant }));
    }
    return groups;
  }, [variants]);

  const attrNames = Object.keys(attributeGroups);
  const isColor = (name: string) => isColorAttr(name);
  const isSizeAttrName = (name: string) => isSizeAttr(name);

  function handleSelect(attrName: string, value: string): void {
    const found = variants.find((v) =>
      v.isActive &&
      v.attributeValues.some((av) =>
        av.attributeValue.attribute.name === attrName &&
        av.attributeValue.value === value
      )
    );
    if (found) {
      onSelect(found);
      onSelectAttr?.(attrName, value);
    }
  }

  function isSelected(v: Variant): boolean {
    if (!selectedVariant) return false;
    return v.id === selectedVariant.id;
  }

  if (attrNames.length === 0) return null;

  return (
    <div className="space-y-2.5 mb-4">
      {attrNames.map((name) => {
        const isColorAttr = isColor(name);
        const isSize = isSizeAttrName(name);

        return (
          <div key={name}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[13px] text-gray-700 font-medium">{name}:</span>
              {isSize && onSizeGuideClick && (
                <button
                  onClick={onSizeGuideClick}
                  className="text-[11px] text-gray-400 hover:text-brand-blue flex items-center gap-1 transition-colors"
                >
                  <span>📏</span>
                  <span className="underline underline-offset-2">Size Guide</span>
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {attributeGroups[name].map(({ value, variant }) => {
                const isActive = variant.stock > 0;
                const selected = selectedVariant && isSelected(variant);

                if (isColorAttr) {
                  const colorVal = getColorValue(value);
                  return (
                    <button
                      key={value}
                      onClick={() => isActive && handleSelect(name, value)}
                      disabled={!isActive}
                      className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                        selected
                          ? 'ring-2 ring-brand-blue ring-offset-1 scale-110'
                          : 'ring-1 ring-gray-300 hover:ring-gray-400'
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
                    onClick={() => isActive && handleSelect(name, value)}
                    disabled={!isActive}
                    className={[
                      "h-9 min-w-[40px] px-3 text-[12px] rounded-md border transition-colors",
                      selected
                        ? "bg-brand-blue text-white border-brand-blue font-medium"
                        : isActive
                          ? "bg-white text-gray-800 border-gray-300 hover:border-brand-blue"
                          : "bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed",
                    ].join(" ")}
                  >
                    {isActive ? (
                      value
                    ) : (
                      <span className="relative">
                        {value}
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="w-full h-px bg-gray-300 absolute" style={{ transform: 'rotate(-12deg)' }} />
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
