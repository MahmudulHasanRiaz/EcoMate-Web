import { describe, it, expect } from "vitest";
import imageLoader from "../image-loader";
import { resolveDerivativeUrl, resolveBlurUrl } from "../image-derivative";
import type { MediaMeta } from "../types";

const WEBP = "https://cdn.example.com/uploads/derivatives/abc/medium.webp";
const AVIF = "https://cdn.example.com/uploads/derivatives/abc/medium.avif";

describe("imageLoader (P3 AVIF)", () => {
  it("maps widths to the closest variant, preserving webp", () => {
    expect(imageLoader({ src: WEBP, width: 300, quality: 75 })).toContain("/small.webp");
    expect(imageLoader({ src: WEBP, width: 640, quality: 75 })).toContain("/medium.webp");
    expect(imageLoader({ src: WEBP, width: 2000, quality: 75 })).toContain("/large.webp");
  });

  it("maps widths to the closest variant, preserving avif (never swaps format blindly)", () => {
    expect(imageLoader({ src: AVIF, width: 375, quality: 75 })).toContain("/medium.avif");
    expect(imageLoader({ src: AVIF, width: 1280, quality: 75 })).toContain("/large.avif");
    expect(imageLoader({ src: AVIF, width: 100, quality: 75 })).toContain("/thumbnail.avif");
  });

  it("hero semantics: a large base resolves to medium at mobile width, large at desktop", () => {
    const heroAvif = "https://cdn.example.com/uploads/derivatives/hero/large.avif";
    // HeroSlideshow sizes: (max-width:768px) 100vw, 66vw — at a 375px
    // phone next/image asks for ~640w candidate → medium derivative.
    expect(imageLoader({ src: heroAvif, width: 640, quality: 75 })).toContain("/medium.avif");
    expect(imageLoader({ src: heroAvif, width: 1536, quality: 75 })).toContain("/large.avif");
  });

  it("passes through non-derivative and local sources unchanged", () => {
    expect(imageLoader({ src: "/placeholder.svg", width: 640, quality: 75 })).toBe("/placeholder.svg");
    expect(imageLoader({ src: "data:image/png;base64,x", width: 640, quality: 75 })).toBe("data:image/png;base64,x");
    const raw = "https://cdn.example.com/uploads/photo.jpg";
    expect(imageLoader({ src: raw, width: 640, quality: 75 })).toBe(raw);
  });
});

describe("resolveDerivativeUrl (P3)", () => {
  const meta: MediaMeta = {
    "/img.jpg": {
      derivativeManifest: {
        small: "/derivatives/1/small.webp",
        small_avif: "/derivatives/1/small.avif",
        large: "/derivatives/1/large.webp",
      },
      blurUrl: "data:image/webp;base64,AAAA",
    },
    "/old.jpg": {
      derivativeManifest: { small: "/derivatives/2/small.webp" },
      blurUrl: null,
    },
  };

  it("prefers the AVIF sibling when the manifest provides one", () => {
    expect(resolveDerivativeUrl(meta, "/img.jpg", "small")).toBe("/derivatives/1/small.avif");
  });

  it("falls back to WebP on pre-P3 manifests and to the raw URL without a manifest", () => {
    expect(resolveDerivativeUrl(meta, "/old.jpg", "small")).toBe("/derivatives/2/small.webp");
    expect(resolveDerivativeUrl(meta, "/missing.jpg", "small")).toBe("/missing.jpg");
    expect(resolveDerivativeUrl(undefined, "/img.jpg", "large")).toBe("/img.jpg");
  });

  it("resolveBlurUrl returns only data: blur URLs", () => {
    expect(resolveBlurUrl(meta, "/img.jpg")).toBe("data:image/webp;base64,AAAA");
    expect(resolveBlurUrl(meta, "/old.jpg")).toBeNull();
  });
});
