import type { ImageLoaderProps } from "next/image";

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

export default function imageLoader({ src, width }: ImageLoaderProps) {
  if (src.startsWith("data:") || src.startsWith("blob:")) return src;

  // Local static assets (e.g. /placeholder.svg, /icons/*.svg) — return as-is.
  if (src.startsWith("/") && !src.startsWith("/uploads/") && !src.startsWith("/assets/")) {
    return src;
  }

  // Derivative URLs already served by backend storage — pick closest variant
  const match = src.match(DERIVATIVE_REGEX);
  if (match) {
    const variant = closestVariant(width);
    if (match[2] !== variant) {
      return `${match[1]}${variant}.${match[3]}`;
    }
    return src;
  }

  // Raw /uploads/ images — serve directly (resize proxy is unreliable in
  // production and breaks ALL storefront images when it fails with a 500).
  // The backend derivative system (displayUrl in ProductImageGallery) already
  // picks the right pre-generated size; the loader just passes the path through.
  return src;
}
