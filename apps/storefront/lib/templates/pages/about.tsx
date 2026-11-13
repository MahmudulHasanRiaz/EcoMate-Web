import { Target, Users, ShieldCheck, Heart } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { resolveDerivativeUrl } from "@/lib/image-derivative";
import { hasText } from "../content-utils";
import type { PageMeta } from "../content-utils";
import { TemplateEmptyState } from "../shared";

// Fixed icon per value slot; defaults mirror the original 3-card design.
const VALUE_ICONS = [ShieldCheck, Target, Heart, Users];

export default function AboutTemplate({
  config,
  storeName,
}: {
  config: Record<string, any>;
  storeName?: string;
  pageMeta?: PageMeta;
}) {
  // Brand name binds to real store settings (passed in by
  // renderPreFormattedPage) — never a literal fallback here.
  const brandName = (storeName || "").trim();
  const tagline = typeof config?.tagline === 'string' ? config.tagline.trim() : "";
  // Serve the hero as a derivative, never the raw original — the backend
  // attaches config._mediaMeta on the public read path (findBySlug).
  const heroImage = config?.image
    ? resolveDerivativeUrl(config?._mediaMeta, config.image, 'large')
    : "";

  const rawStory = typeof config?.story === 'string' ? config.story : '';
  const storyParagraphs = rawStory
    .split('\n\n')
    .map((p) => p.trim())
    .filter(Boolean);

  const storyHeading = storyParagraphs[0] || "";
  const bodyParagraphs = storyParagraphs.length > 1 ? storyParagraphs.slice(1) : [];

  const values = Array.isArray(config?.values) ? config.values : [];
  // Matches templateHasRealContent('about', config): the brand name alone
  // is not page content — an unconfigured page shows the empty state.
  const hasContent =
    hasText(rawStory) || hasText(tagline) || values.length > 0 || hasText(heroImage);

  if (!hasContent) {
    return (
      <TemplateEmptyState
        title="About Us"
        message="We're still writing our story — check back soon to learn more about us."
      />
    );
  }

  return (
    <div className="bg-white">
      {/* Hero Section */}
      <section className="relative h-[40vh] md:h-[50vh] flex items-center justify-center bg-brand-dark overflow-hidden">
        {heroImage && (
          <div className="absolute inset-0 opacity-40">
            <Image
              src={heroImage}
              alt={brandName || "About us"}
              fill
              sizes="100vw"
              className="object-cover"
            />
          </div>
        )}
        <div className="relative z-10 text-center px-4">
          {brandName && (
            <h1 className="text-4xl md:text-6xl font-black text-white mb-4 tracking-tight uppercase skew-x-[-2deg]">
              {brandName}
            </h1>
          )}
          {tagline && (
            <p className="text-gray-300 max-w-2xl mx-auto text-sm md:text-base font-medium">
              {tagline}
            </p>
          )}
        </div>
      </section>

      {/* Story Section */}
      {(storyParagraphs.length > 0 || heroImage) && (
        <section className="max-w-7xl mx-auto px-4 py-16 md:py-24">
          <div className={`grid grid-cols-1 gap-12 items-center ${heroImage ? 'md:grid-cols-2' : ''}`}>
            <div>
              <div className="text-[10px] font-bold tracking-[0.2em] text-brand-blue uppercase mb-4">Our Story</div>
              {storyHeading && (
                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6 leading-tight">
                  {storyHeading}
                </h2>
              )}
              <div className="space-y-4 text-gray-600 leading-relaxed text-[15px]">
                {bodyParagraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </div>
            {heroImage && (
              <div className="relative aspect-[3/4] max-w-md w-full mx-auto rounded-2xl overflow-hidden shadow-2xl">
                <Image src={heroImage} alt={brandName || "About us"} fill sizes="50vw" className="object-cover" />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Values Section - Bento Grid */}
      {values.length > 0 && (
        <section className="bg-gray-50 py-20 px-4">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-gray-900">What Drives Us</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {values.map((value, i) => {
                const Icon = VALUE_ICONS[i % VALUE_ICONS.length];
                return (
                  <ValueCard
                    key={i}
                    icon={<Icon className="text-brand-blue" size={32} />}
                    title={value?.title ?? ''}
                    description={value?.description ?? ''}
                  />
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="py-20 text-center px-4">
        <h2 className="text-3xl font-bold mb-8">Want to see our quality yourself?</h2>
        <Link
          href="/products"
          className="inline-block bg-brand-blue text-white px-10 py-4 rounded-full font-bold shadow-xl hover:scale-105 transition-transform"
        >
          Explore Products
        </Link>
      </section>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ValueCard({ icon, title, description }: { icon: any, title: string, description: string }) {
  return (
    <div className="bg-white p-10 rounded-[32px] border border-gray-100 shadow-sm hover:shadow-xl transition-all group">
      <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-8 group-hover:bg-brand-blue/10 transition-colors">
        {icon}
      </div>
      <h3 className="text-xl font-bold text-gray-900 mb-4">{title}</h3>
      <p className="text-gray-500 leading-relaxed">{description}</p>
    </div>
  );
}
