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
          <div className="md:col-span-8 overflow-hidden md:rounded-[20px] shadow-sm bg-white relative group">
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

          {/* Secondary Banner */}
          <div className="hidden md:block md:col-span-4 overflow-hidden rounded-[20px] shadow-sm bg-white">
            <div className="relative w-full aspect-[5/4]">
              <Image
                src={resolvedSecondary}
                alt={secondaryBannerAlt || 'Featured banner'}
                fill
                priority
                sizes="(max-width: 768px) 0vw, 33vw"
                className="object-cover"
              />
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
