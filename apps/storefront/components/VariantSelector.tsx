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

function sortValues(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const aIdx = SIZE_ORDER[a] ?? 999;
    const bIdx = SIZE_ORDER[b] ?? 999;
    if (aIdx !== 999 || bIdx !== 999) return aIdx - bIdx;
    return a.localeCompare(b);
  });
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
    <div className="space-y-4 mb-6">
      {attrNames.map((name) => (
        <div key={name}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[14px] text-gray-700 font-medium">{name}:</span>
            {name === attrNames[attrNames.length - 1] && onSizeGuideClick && (
              <button
                onClick={onSizeGuideClick}
                className="text-[12px] text-gray-400 hover:text-brand-blue flex items-center gap-1 transition-colors"
              >
                <span>📏</span>
                <span className="underline underline-offset-2">Size Guide</span>
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {attributeGroups[name].map(({ value, variant }) => {
              const isActive = variant.stock > 0;
              const selected = selectedVariant && isSelected(variant);
              return (
                <button
                  key={value}
                  onClick={() => isActive && handleSelect(name, value)}
                  disabled={!isActive}
                  style={{ minWidth: '44px', minHeight: '44px' }}
                  className={[
                    "px-4 text-[13px] rounded-md border transition-colors",
                    selected
                      ? "bg-brand-blue text-white border-brand-blue font-medium"
                      : isActive
                        ? "bg-white text-gray-800 border-gray-300 hover:border-brand-blue"
                        : "bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed relative overflow-hidden",
                  ].join(" ")}
                >
                  {isActive ? (
                    value
                  ) : (
                    <span className="relative">
                      {value}
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="w-full h-px bg-gray-300 absolute top-1/2 left-0" style={{ transform: 'rotate(-15deg)' }} />
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
