"use client";

import Image from "next/image";
import { PLACEHOLDER_IMAGE } from "@/lib/constants";

export function BrandLogoImage({ src, alt, fallback }: { src: string; alt: string; fallback?: string }) {
  const fallbackSrc = fallback || PLACEHOLDER_IMAGE;
  return (
    <Image
      src={src}
      alt={alt}
      width={120}
      height={60}
      className="max-h-full max-w-full object-contain grayscale hover:grayscale-0 transition-all duration-300"
      onError={(e) => { (e.target as HTMLImageElement).src = fallbackSrc; }}
    />
  );
}
