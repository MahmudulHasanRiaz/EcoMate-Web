import { Target, Users, ShieldCheck, Heart } from 'lucide-react';
import Image from 'next/image';
import { PLACEHOLDER_IMAGE } from "@/lib/constants";

const FALLBACK_STORY_HEADING = 'Started with a mission to bring excellence in every interaction.';

const FALLBACK_PARAGRAPHS = [
  'Store was born from a simple realization: the market lacked high-quality, reliable technology and household solutions. We wanted to bridge the gap between innovation and consumer needs.',
  'Our journey began in 2024 with a vision to redefine reliability. Today, we have grown into a multi-vertical platform serving thousands of customers across the nation.',
  'Every solution we offer goes through extensive testing. We don\'t just provide products; we provide confidence.',
];

// Fixed icon per value slot; defaults mirror the original 3-card design.
const VALUE_ICONS = [ShieldCheck, Target, Heart, Users];

export default function AboutTemplate({ config }: { config: Record<string, any> }) {
  const storeName = 'Store';
  const heroImage = config?.image ? config.image : PLACEHOLDER_IMAGE;

  const rawStory = typeof config?.story === 'string' ? config.story : '';
  const storyParagraphs = rawStory
    .split('\n\n')
    .map((p) => p.trim())
    .filter(Boolean);

  const storyHeading = storyParagraphs[0] || FALLBACK_STORY_HEADING;

  let bodyParagraphs: string[];
  if (storyParagraphs.length > 1) {
    bodyParagraphs = storyParagraphs.slice(1);
  } else if (storyParagraphs.length === 1) {
    bodyParagraphs = storyParagraphs;
  } else {
    bodyParagraphs = FALLBACK_PARAGRAPHS;
  }

  const values = Array.isArray(config?.values) ? config.values : [];

  return (
    <div className="bg-white">
      {/* Hero Section */}
      <section className="relative h-[40vh] md:h-[50vh] flex items-center justify-center bg-[#1a1a1a] overflow-hidden">
        <div className="absolute inset-0 opacity-40">
          <Image
            src={heroImage}
            alt={storeName}
            fill
            sizes="100vw"
            className="object-cover"
          />
        </div>
        <div className="relative z-10 text-center px-4">
          <h1 className="text-4xl md:text-6xl font-black text-white mb-4 tracking-tight uppercase skew-x-[-2deg]">
            {storeName}
          </h1>
          <p className="text-gray-300 max-w-2xl mx-auto text-sm md:text-base font-medium">
            {`Dedicated to providing the most reliable and innovative solutions to every household in Bangladesh.`}
          </p>
        </div>
      </section>

      {/* Story Section */}
      <section className="max-w-7xl mx-auto px-4 py-16 md:py-24">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="text-[10px] font-bold tracking-[0.2em] text-brand-blue uppercase mb-4">Our Story</div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6 leading-tight">
              {storyHeading}
            </h2>
            <div className="space-y-4 text-gray-600 leading-relaxed text-[15px]">
              {bodyParagraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="aspect-[3/4] rounded-2xl overflow-hidden shadow-2xl skew-y-2 relative">
              <Image src={PLACEHOLDER_IMAGE} alt="Tech Repair" fill sizes="25vw" className="object-cover" />
            </div>
            <div className="aspect-[3/4] rounded-2xl overflow-hidden shadow-2xl -skew-y-2 translate-y-12 relative">
              <Image src={PLACEHOLDER_IMAGE} alt="Gadgets" fill sizes="25vw" className="object-cover" />
            </div>
          </div>
        </div>
      </section>

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
        <a
          href="#"
          className="inline-block bg-brand-blue text-white px-10 py-4 rounded-full font-bold shadow-xl hover:scale-105 transition-transform"
        >
          Explore Ecosystem
        </a>
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
