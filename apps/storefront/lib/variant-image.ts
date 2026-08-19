import type { Product, Variant } from "@/lib/types";

const COLOR_KEYWORDS = ["color", "colour", "clr", "কালার", "রং", "রঙ"];

export type VariantImageSource = Pick<Product, "image" | "images">;

export function resolveVariantImage(
  variant: Variant | null | undefined,
  product: VariantImageSource,
): string | undefined {
  if (variant) {
    const own = variant.images?.[0] || variant.image;
    if (own) return own;

    const withImage = (variant.attributeValues || []).filter(
      (av) => av.attributeValue?.image,
    );
    if (withImage.length > 0) {
      const color = withImage.find((av) =>
        COLOR_KEYWORDS.some((k) =>
          av.attributeValue.attribute?.name?.toLowerCase().includes(k),
        ),
      );
      return (color || withImage[0]).attributeValue.image;
    }
  }
  return product.image || product.images?.[0] || undefined;
}

export function parentImage(product: VariantImageSource): string | undefined {
  return product.image || product.images?.[0] || undefined;
}
