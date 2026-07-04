import type { ImageLoaderProps } from "next/image";

const RESIZE_API = "/api/images/resize";

function shouldResize(src: string): boolean {
  if (src.startsWith("data:")) return false;
  if (src.startsWith("blob:")) return false;
  if (src.startsWith("http://") || src.startsWith("https://")) return false;
  return src.startsWith("/");
}

export default function imageLoader({ src, width, quality }: ImageLoaderProps) {
  if (!shouldResize(src)) return src;

  const params = new URLSearchParams({
    path: src,
    w: String(width),
    q: String(quality || 75),
    fit: "cover",
  });

  return `${RESIZE_API}?${params.toString()}`;
}
