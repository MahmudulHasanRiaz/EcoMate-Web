import { ShieldCheck, ArrowRightLeft, RefreshCw, AlertCircle } from 'lucide-react';

/**
 * CMS-driven "pre-formatted page" template for the Refund Policy page.
 * The `config` prop is hydrated by renderPreFormattedPage from the matching
 * CmsPage row (merged over the registry defaults). The amber warning box and
 * the header copy are fixed design elements and intentionally not configurable.
 */
export default function RefundPolicyTemplate({ config }: { config: Record<string, any> }) {
  const sections = Array.isArray(config.sections) ? config.sections : [];
  const contactEmail = typeof config.contactEmail === "string" ? config.contactEmail : "";

  return (
    <div className="bg-white min-h-screen">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-100 py-16 md:py-24">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-blue/10 rounded-xl text-brand-blue mb-6 animate-bounce">
             <RefreshCw size={24} />
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-gray-900 mb-6 tracking-tight">Refund <span className="text-brand-blue">Policy</span></h1>
          <p className="text-gray-500 text-lg max-w-2xl mx-auto">
            We want you to be 100% satisfied with your purchase. Read how we handle returns and refunds.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-16">
        <div className="space-y-12">
          {sections.map((section, index) => (
            <PolicySection
              key={index}
              number={String(index + 1).padStart(2, "0")}
              title={typeof section?.heading === "string" ? section.heading : ""}
              content={typeof section?.body === "string" ? section.body : ""}
            />
          ))}

          {/* Warning Box */}
          <div className="bg-amber-50 border-l-4 border-amber-400 p-8 rounded-r-2xl">
            <div className="flex items-start gap-4">
              <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={24} />
              <div>
                <h4 className="font-bold text-amber-900 mb-2">Important Notice</h4>
                <p className="text-amber-800/80 text-[15px] leading-relaxed">
                  Refund requests must be initiated within 24 hours of receiving the shipment. Since most of our items are perishable foods, we cannot accept returns after this period for hygiene and quality reasons.
                </p>
              </div>
            </div>
          </div>

          {contactEmail && (
            <div className="pt-12 text-center">
              <p className="text-gray-400 text-sm mb-6 font-mono uppercase tracking-widest">Questions?</p>
              <a href={`mailto:${contactEmail}`} className="text-brand-blue font-bold text-xl hover:underline">{contactEmail}</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PolicySection({ number, title, content }: { number: string, title: string, content: string | string[] }) {
  const items = Array.isArray(content)
    ? content
    : content.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);

  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[100px_1fr] gap-4">
      <div className="font-mono text-4xl font-black text-gray-100 hidden md:block">{number}</div>
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">{title}</h2>
        {items.length > 1 ? (
          <ul className="space-y-4">
            {items.map((item, idx) => (
              <li key={idx} className="flex items-start gap-3 text-gray-600">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-blue mt-2.5 shrink-0" />
                <span className="text-[15px] leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-600 leading-relaxed text-[15px]">{items[0]}</p>
        )}
      </div>
    </div>
  );
}
