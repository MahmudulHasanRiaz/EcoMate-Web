import type { ImageLoaderProps } from "next/image";

const RESIZE_API = "/api/images/resize";

export default function imageLoader({ src, width, quality }: ImageLoaderProps) {
  if (src.startsWith("data:") || src.startsWith("blob:")) return src;

  const params = new URLSearchParams({
    path: src,
    w: String(width),
    q: String(quality || 75),
    fit: "cover",
  });

  return `${RESIZE_API}?${params.toString()}`;
}
