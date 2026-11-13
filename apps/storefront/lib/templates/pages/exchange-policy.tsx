import type { ReactNode } from "react";
import { ArrowRightLeft, PackageCheck, Truck, ShieldAlert } from 'lucide-react';
import { PolicyShell } from "../policy-shell";
import { RichText, TemplateEmptyState } from "../shared";
import { hasText } from "../content-utils";
import type { PageMeta } from "../content-utils";

interface SectionItem {
  heading?: string;
  body?: string;
  /** Semantic role: 'step' renders as a step card, anything else as a
      condition. Rows written before this field existed carry no kind — see
      the legacy fallback below. */
  kind?: string;
}

const STEP_ICONS = [PackageCheck, Truck, ShieldAlert];

export default function ExchangePolicyTemplate({
  config,
  pageMeta,
}: {
  config: Record<string, any>;
  storeName?: string;
  pageMeta?: PageMeta;
}) {
  const sections: SectionItem[] = Array.isArray(config?.sections) ? config.sections : [];
  const intro = typeof config?.intro === "string" ? config.intro : "";
  const quote = typeof config?.quote === "string" ? config.quote : "";

  // Semantic step-vs-condition: once any section carries an explicit kind,
  // kind governs. Until then (rows written before the kind field existed)
  // the old positional split — first three are steps — is preserved so an
  // existing tenant's page renders exactly as before.
  const hasExplicitKinds = sections.some(
    (s) => typeof s?.kind === "string" && s.kind.length > 0,
  );
  const stepSections = hasExplicitKinds
    ? sections.filter((s) => s.kind === "step")
    : sections.slice(0, 3);
  const conditionSections = hasExplicitKinds
    ? sections.filter((s) => s.kind !== "step")
    : sections.slice(3);

  if (sections.length === 0) {
    return <TemplateEmptyState title="Exchange Policy" />;
  }

  return (
    <PolicyShell
      title="Exchange Policy"
      eyebrow="Hassle Free"
      intro={hasText(intro) ? intro : undefined}
      pageMeta={pageMeta}
      wide
    >
      {/* Steps Section */}
      <section className="max-w-6xl mx-auto relative z-20 pb-24">
        {stepSections.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {stepSections.map((section, idx) => {
              const Icon = STEP_ICONS[idx % STEP_ICONS.length];
              return (
                <StepCard
                  key={idx}
                  icon={<Icon size={32} />}
                  title={String(section.heading ?? "")}
                  body={String(section.body ?? "")}
                />
              );
            })}
          </div>
        )}

        <div className="mt-24 grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          {conditionSections.length > 0 && (
            <div>
              <h2 className="text-3xl font-bold mb-8 text-gray-900">Exchange Conditions</h2>
              <div className="space-y-6">
                {conditionSections.map((section, idx) => (
                  <ConditionItem
                    key={idx}
                    title={String(section.heading ?? "")}
                    body={String(section.body ?? "")}
                  />
                ))}
              </div>
            </div>
          )}
          {quote && (
            <div className="bg-gray-100 rounded-[40px] aspect-square flex items-center justify-center p-12">
              <div className="relative w-full h-full border-2 border-dashed border-gray-300 rounded-[32px] flex flex-col items-center justify-center text-center p-8">
                 <ArrowRightLeft size={64} className="text-brand-blue mb-6 animate-pulse" />
                 <p className="text-gray-500 font-medium italic">&ldquo;{quote}&rdquo;</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </PolicyShell>
  );
}

function StepCard({ icon, title, body }: { icon: ReactNode, title: string, body: string }) {
  return (
    <div className="bg-white p-8 rounded-[32px] shadow-2xl shadow-gray-200 border border-gray-50 flex flex-col items-center text-center">
      <div className="w-16 h-16 bg-brand-blue text-white rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-brand-blue/20">
        {icon}
      </div>
      <h3 className="font-bold text-gray-900 text-lg mb-3">{title}</h3>
      <RichText body={body} className="text-gray-500 text-sm leading-relaxed" />
    </div>
  );
}

function ConditionItem({ title, body }: { title: string, body: string }) {
  return (
    <div className="flex gap-4">
      <div className="w-5 h-5 rounded-full bg-brand-blue/10 border border-brand-blue/20 flex items-center justify-center shrink-0 mt-1">
        <div className="w-1.5 h-1.5 rounded-full bg-brand-blue" />
      </div>
      <div>
        <h4 className="font-bold text-gray-800 mb-1">{title}</h4>
        <RichText body={body} className="text-gray-500 text-sm" />
      </div>
    </div>
  );
}
