import { Fragment } from "react";
import { FileText, Gavel, Scale, AlertCircle } from 'lucide-react';

interface TermsSection {
  heading?: string;
  body?: string;
}

function toParagraphs(body?: string): string[] {
  if (!body) return [];
  return body
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export default function TermsConditionsTemplate({ config }: { config: Record<string, any> }) {
  const sections: TermsSection[] = (Array.isArray(config?.sections) ? config.sections : []).filter(
    (s: any) =>
      s &&
      typeof s === "object" &&
      ((typeof s.heading === "string" && s.heading.trim().length > 0) ||
        (typeof s.body === "string" && s.body.trim().length > 0))
  );

  if (!sections.length) return null;

  // The final section renders as the highlighted "callout" card, mirroring the
  // fixed design (content sections first, single highlighted card at the end).
  const contentSections = sections.length > 1 ? sections.slice(0, -1) : sections;
  const calloutSection = sections.length > 1 ? sections[sections.length - 1] : null;
  const calloutParagraphs = calloutSection ? toParagraphs(calloutSection.body) : [];

  return (
    <div className="bg-amber-50/30 min-h-screen pb-24">
      {/* Editorial Header */}
      <div className="max-w-7xl mx-auto px-4 pt-20 pb-16 border-b border-gray-200">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
          <h1 className="text-6xl md:text-[120px] font-black text-gray-900 leading-[0.8] tracking-tighter">
            TERMS <br /><span className="text-brand-blue opacity-80">OF SERVICE.</span>
          </h1>
          <div className="md:w-64 pb-4">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-blue mb-2 flex items-center gap-2">
              <Scale size={14} /> Legal Agreement
            </p>
            <p className="text-gray-500 text-[11px] leading-relaxed italic">
              By using Store, you agree to follow these rules and regulations which ensure a safe marketplace for everyone.
            </p>
          </div>
        </div>
      </div>

      {/* Grid Content */}
      <div className="max-w-7xl mx-auto px-4 mt-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-4">
            <div className="sticky top-24 space-y-4">
              <SidebarLink number="01" label="Operating Entities" active />
              <SidebarLink number="02" label="Product Availability" />
              <SidebarLink number="03" label="Pricing & Payments" />
              <SidebarLink number="04" label="Delivery Conditions" />
              <SidebarLink number="05" label="Liabilities" />
            </div>
          </div>

          <div className="lg:col-span-8">
            <div className="prose prose-gray prose-lg max-w-none text-gray-600">
              {contentSections.map((section, index) => (
                <Fragment key={index}>
                  {section.heading && (
                    <h3 className="text-2xl font-bold text-gray-900 mb-6">{section.heading}</h3>
                  )}
                  {toParagraphs(section.body).map((paragraph, i) => (
                    <p key={i} className="mb-8">{paragraph}</p>
                  ))}
                </Fragment>
              ))}

              {calloutSection && (
                <div className="bg-white p-10 rounded-[32px] border border-gray-200 mt-16 shadow-sm">
                  {calloutSection.heading && (
                    <h4 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <AlertCircle className="text-brand-blue" size={20} />
                      {calloutSection.heading}
                    </h4>
                  )}
                  {calloutParagraphs.map((paragraph, i) => (
                    <p
                      key={i}
                      className={i < calloutParagraphs.length - 1 ? "text-[15px] leading-relaxed mb-4" : "text-[15px] leading-relaxed"}
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarLink({ number, label, active }: { number: string, label: string, active?: boolean }) {
  return (
    <button className={`w-full flex items-center gap-6 p-4 rounded-2xl transition-all ${active ? 'bg-white shadow-xl shadow-gray-200/50' : 'hover:bg-white/50 grayscale opacity-60 hover:grayscale-0 hover:opacity-100'}`}>
      <span className="font-mono text-xs font-bold text-brand-blue">{number}</span>
      <span className={`text-sm font-bold tracking-tight ${active ? 'text-gray-900' : 'text-gray-500'}`}>{label}</span>
      {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-blue" />}
    </button>
  );
}
