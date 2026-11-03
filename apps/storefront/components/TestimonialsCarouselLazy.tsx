"use client";

// P5 (JS diet): the homepage testimonials carousel sits below the fold and
// pulls in motion/react. Testimonials (a Server Component) cannot code-split
// a dynamically imported Client Component per the Next 16.4 lazy-loading
// guide, so the dynamic() call lives in this thin client wrapper instead.
// The loading placeholder reserves the carousel's space with the same
// spinner style as the PDP sheet fallback, so nothing shifts when it loads.

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type TestimonialsCarousel from "./TestimonialsCarousel";

function CarouselLoading() {
  return (
    <div
      className="flex min-h-[220px] items-center justify-center"
      aria-hidden="true"
    >
      <div className="w-8 h-8 border-2 border-gray-200 border-t-brand-blue rounded-full animate-spin" />
    </div>
  );
}

const LazyTestimonialsCarousel = dynamic(() => import("./TestimonialsCarousel"), {
  loading: CarouselLoading,
});

export default function TestimonialsCarouselLazy(
  props: ComponentProps<typeof TestimonialsCarousel>,
) {
  return <LazyTestimonialsCarousel {...props} />;
}
