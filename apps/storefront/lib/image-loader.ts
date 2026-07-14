import type { ImageLoaderProps } from "next/image";

const RESIZE_API = "/api/images/resize";

// Derivative variant widths in pixels
const DERIVATIVE_SIZES = [
  { name: "thumbnail", maxWidth: 150 },
  { name: "small", maxWidth: 320 },
  { name: "medium", maxWidth: 640 },
  { name: "large", maxWidth: Infinity },
] as const;

const DERIVATIVE_REGEX = /^(.*\/derivatives\/[^/]+\/)(\w+)\.(webp|jpg|jpeg|png)$/;

function closestVariant(width: number): string {
  for (const v of DERIVATIVE_SIZES) {
    if (width <= v.maxWidth) return v.name;
  }
  return "large";
}

export default function imageLoader({ src, width, quality }: ImageLoaderProps) {
  if (src.startsWith("data:") || src.startsWith("blob:")) return src;

  // Derivative URLs: map requested width to closest variant
  const match = src.match(DERIVATIVE_REGEX);
  if (match) {
    const variant = closestVariant(width);
    // Only rewrite if variant differs from current — avoids unnecessary URL change
    if (match[2] !== variant) {
      return `${match[1]}${variant}.${match[3]}`;
    }
    return src;
  }

  const params = new URLSearchParams({
    path: src,
    w: String(width),
    q: String(quality || 75),
    fit: "cover",
  });

  return `${RESIZE_API}?${params.toString()}`;
}
