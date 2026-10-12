import Image from "next/image";
import { PLACEHOLDER_IMAGE } from "@/lib/constants";
import type { MediaMeta } from "@/lib/types";
import HeroSlideshow from "./HeroSlideshow";

interface HeroSlide {
  image: string;
  link?: string;
  alt?: string;
}

function resolveDerivative(url: string, mediaMeta: MediaMeta | undefined, variant: string): string {
  if (!url) return '';
  return mediaMeta?.[url]?.derivativeManifest?.[variant] || url;
}

export default function Hero({
  slides = [],
  secondaryBanner = '',
  secondaryBannerAlt = '',
  mediaMeta,
}: {
  slides: HeroSlide[];
  secondaryBanner?: string;
  secondaryBannerAlt?: string;
  mediaMeta?: MediaMeta;
}) {
  const resolvedSlides = slides.map(s => ({
    ...s,
    image: resolveDerivative(s.image, mediaMeta, 'large'),
  }));
  const resolvedSecondary = resolveDerivative(secondaryBanner, mediaMeta, 'large');
  const resolvedPlaceholder = PLACEHOLDER_IMAGE;

  return (
    <section className="w-full bg-[#fcfcfc] md:py-6">
      <div className="md:max-w-7xl md:mx-auto md:px-4">
        <div className="grid grid-cols-1 md:grid-cols-12 md:gap-4">

          {/* Main Banner */}
          <div className="md:col-span-8 overflow-hidden md:rounded-xl shadow-sm bg-white relative group">
            <div className="relative w-full aspect-[5/2] md:aspect-[5/2]">
              {slides.length > 0 ? (
                <HeroSlideshow slides={resolvedSlides} />
              ) : (
                <Image
                  src={resolvedPlaceholder}
                  alt="Featured banner"
                  fill
                  priority
                  className="object-cover"
                />
              )}
            </div>
          </div>

          {/* Secondary Banner: fills the full row height (flex-1). A fixed
              aspect box is ~6px shorter than the main column (grid gaps break
              the 5/2-vs-5/4 height equality) and leaves a white strip below
              the image — see hero.test.tsx. object-cover absorbs the tiny
              ratio difference. */}
          {resolvedSecondary && (
            <div className="hidden md:flex md:flex-col md:col-span-4 overflow-hidden rounded-xl shadow-sm bg-white">
              <div className="relative w-full flex-1 min-h-0">
                <Image
                  src={resolvedSecondary}
                  alt={secondaryBannerAlt || 'Featured banner'}
                  fill
                  sizes="(max-width: 768px) 0vw, 33vw"
                  className="object-cover"
                />
              </div>
            </div>
          )}

        </div>
      </div>
    </section>
  );
}
