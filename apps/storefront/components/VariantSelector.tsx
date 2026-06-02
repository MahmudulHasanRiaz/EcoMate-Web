"use client";

import { useMemo } from "react";
import type { Variant } from "@/lib/types";

interface Props {
  variants: Variant[];
  selectedVariant: Variant | null;
  onSelect: (variant: Variant) => void;
}

export function VariantSelector({ variants, selectedVariant, onSelect }: Props) {
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
    if (found) onSelect(found);
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
          <span className="text-[14px] text-gray-700 font-medium block mb-2">{name}:</span>
          <div className="flex flex-wrap gap-2">
            {attributeGroups[name].map(({ value, variant }) => {
              const isActive = variant.stock > 0;
              const selected = selectedVariant && isSelected(variant);
              return (
                <button
                  key={value}
                  onClick={() => isActive && handleSelect(name, value)}
                  disabled={!isActive}
                  className={[
                    "px-4 py-2 text-[13px] rounded-md border transition-colors",
                    selected
                      ? "bg-brand-blue text-white border-brand-blue"
                      : isActive
                        ? "bg-white text-gray-800 border-gray-300 hover:border-brand-blue"
                        : "bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed",
                  ].join(" ")}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
