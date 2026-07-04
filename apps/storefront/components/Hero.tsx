import Image from "next/image";
import { PLACEHOLDER_IMAGE } from "@/lib/constants";
import HeroSlideshow from "./HeroSlideshow";

interface HeroSlide {
  image: string;
  link?: string;
  alt?: string;
}

export default function Hero({
  slides = [],
  secondaryBanner = '',
  secondaryBannerAlt = '',
}: {
  slides: HeroSlide[];
  secondaryBanner?: string;
  secondaryBannerAlt?: string;
}) {
  return (
    <section className="w-full bg-[#fcfcfc] py-2 md:py-6">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">

          {/* Main Banner */}
          <div className="md:col-span-8 overflow-hidden rounded-[12px] md:rounded-[20px] shadow-sm bg-white relative group">
            <div className="relative w-full aspect-[5/2]">
              {slides.length > 0 ? (
                <HeroSlideshow slides={slides} />
              ) : (
                <Image
                  src={PLACEHOLDER_IMAGE}
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
                src={secondaryBanner || PLACEHOLDER_IMAGE}
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
