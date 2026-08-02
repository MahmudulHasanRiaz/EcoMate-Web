import type { ReactNode } from "react";
import { ArrowRightLeft, PackageCheck, Truck, ShieldAlert } from 'lucide-react';

interface SectionItem {
  heading?: string;
  body?: string;
}

const STEP_ICONS = [PackageCheck, Truck, ShieldAlert];

export default function ExchangePolicyTemplate({ config }: { config: Record<string, any> }) {
  const sections: SectionItem[] = Array.isArray(config?.sections) ? config.sections : [];
  const stepSections = sections.slice(0, 3);
  const conditionSections = sections.slice(3);

  return (
    <div className="bg-white min-h-screen">
      {/* Header */}
      <div className="bg-brand-blue/5 py-20 md:py-32 overflow-hidden relative">
        <div className="absolute top-0 right-0 w-96 h-96 bg-brand-blue/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="max-w-4xl mx-auto px-4 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand-blue text-white text-[10px] font-bold rounded-full uppercase tracking-wider mb-8">
            <ArrowRightLeft size={12} />
            Hassle Free
          </div>
          <h1 className="text-4xl md:text-7xl font-black text-gray-900 mb-8 leading-tight">
            Exchange <br /><span className="text-brand-blue">Simplified.</span>
          </h1>
          <p className="text-gray-600 text-lg md:text-xl max-w-xl leading-relaxed">
            Ordered the wrong size or changed your mind? We&apos;ve got you covered with our easy exchange policy.
          </p>
        </div>
      </div>

      {/* Steps Section */}
      <section className="max-w-6xl mx-auto px-4 -mt-16 relative z-20 pb-24">
        {stepSections.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {stepSections.map((section, idx) => {
              const Icon = STEP_ICONS[idx % STEP_ICONS.length];
              return (
                <StepCard
                  key={idx}
                  icon={<Icon size={32} />}
                  title={String(section.heading ?? "")}
                  description={String(section.body ?? "")}
                />
              );
            })}
          </div>
        )}

        <div className="mt-24 grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          {conditionSections.length > 0 && (
            <div>
              <h2 className="text-3xl font-bold mb-8">Exchange Conditions</h2>
              <div className="space-y-6">
                {conditionSections.map((section, idx) => (
                  <ConditionItem
                    key={idx}
                    title={String(section.heading ?? "")}
                    desc={String(section.body ?? "")}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="bg-gray-100 rounded-[40px] aspect-square flex items-center justify-center p-12">
            <div className="relative w-full h-full border-2 border-dashed border-gray-300 rounded-[32px] flex flex-col items-center justify-center text-center p-8">
               <ArrowRightLeft size={64} className="text-brand-blue mb-6 animate-pulse" />
               <p className="text-gray-500 font-medium italic">&ldquo;We believe a happy customer is a returning customer.&rdquo;</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function StepCard({ icon, title, description }: { icon: ReactNode, title: string, description: string }) {
  return (
    <div className="bg-white p-8 rounded-[32px] shadow-2xl shadow-gray-200 border border-gray-50 flex flex-col items-center text-center">
      <div className="w-16 h-16 bg-brand-blue text-white rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-brand-blue/20">
        {icon}
      </div>
      <h3 className="font-bold text-gray-900 text-lg mb-3">{title}</h3>
      <Paragraphs text={description} className="text-gray-500 text-sm leading-relaxed" />
    </div>
  );
}

function ConditionItem({ title, desc }: { title: string, desc: string }) {
  return (
    <div className="flex gap-4">
      <div className="w-5 h-5 rounded-full bg-brand-blue/10 border border-brand-blue/20 flex items-center justify-center shrink-0 mt-1">
        <div className="w-1.5 h-1.5 rounded-full bg-brand-blue" />
      </div>
      <div>
        <h4 className="font-bold text-gray-800 mb-1">{title}</h4>
        <Paragraphs text={desc} className="text-gray-500 text-sm" />
      </div>
    </div>
  );
}

function Paragraphs({ text, className }: { text: string, className: string }) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return null;
  if (paragraphs.length === 1) return <p className={className}>{paragraphs[0]}</p>;
  return (
    <div className="space-y-2">
      {paragraphs.map((paragraph, idx) => (
        <p key={idx} className={className}>{paragraph}</p>
      ))}
    </div>
  );
}
