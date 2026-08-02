import { Lock, Eye, FileText, Database } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * CMS-driven "pre-formatted page" template for the Privacy Policy page.
 * The `config` prop is hydrated by renderPreFormattedPage from the matching
 * CmsPage row (merged over the registry defaults). The header, the per-heading
 * icons, and the "Last Updated" footer are fixed design elements and
 * intentionally not configurable.
 */
export default function PrivacyPolicyTemplate({ config }: { config: Record<string, any> }) {
  const sections = Array.isArray(config.sections) ? config.sections : [];

  return (
    <div className="bg-brand-dark min-h-screen text-white pt-24 pb-32">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="mb-20">
          <div className="flex items-center gap-3 text-brand-blue font-mono text-sm tracking-widest uppercase mb-8">
            <Lock size={16} />
            <span>Secure & Private</span>
          </div>
          <h1 className="text-5xl md:text-8xl font-black mb-8 leading-[0.85] tracking-tighter">
            Privacy <br /><span className="text-brand-blue">Protocols.</span>
          </h1>
          <div className="h-1 w-24 bg-brand-blue mb-12" />
          <p className="text-gray-400 text-lg leading-relaxed max-w-2xl">
            Your trust is our most valuable asset. Learn how we collect, protect, and handle your data with transparency and care.
          </p>
        </div>

        {/* Content Sections */}
        <div className="space-y-24">
          {sections.map((section, index) => (
            <SectionRenderer key={index} section={section} />
          ))}

          <div className="text-center pt-12 border-t border-white/10">
            <p className="text-gray-500 text-xs font-mono uppercase tracking-[0.3em]">Last Updated: January 2024</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Preserves the current page's icon assignments keyed by section heading.
function getSectionIcon(heading: string): ReactNode {
  switch (heading) {
    case "Data Collection":
      return <Eye size={24} />;
    case "Usage Disclosure":
      return <Database size={24} />;
    case "Security Architecture":
      return <Shield size={24} />;
    default:
      return <FileText size={24} />;
  }
}

function SectionRenderer({ section }: { section: Record<string, any> }) {
  const heading = typeof section?.heading === "string" ? section.heading.trim() : "";
  const paragraphs = typeof section?.body === "string"
    ? section.body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
    : [];

  // Gracefully skip fully-empty sections.
  if (!heading && paragraphs.length === 0) return null;

  // Replicate the "User Rights" 4-cell grid layout for any section whose body
  // has exactly 4 paragraphs (matches the current page's design).
  if (paragraphs.length === 4) {
    return (
      <div className="bg-[#1a1a1a] p-12 rounded-[40px] border border-white/5">
        {heading && <h3 className="text-2xl font-bold mb-6">{heading}</h3>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-gray-400 text-sm">
          {paragraphs.map((p, idx) => (
            <p key={idx}>{p}</p>
          ))}
        </div>
      </div>
    );
  }

  return (
    <PrivacySection
      icon={getSectionIcon(heading)}
      title={heading}
      paragraphs={paragraphs}
    />
  );
}

function PrivacySection({ icon, title, paragraphs }: { icon: ReactNode, title: string, paragraphs: string[] }) {
  const paragraphClass = "text-gray-400 leading-relaxed text-base md:text-lg";
  return (
    <div className="grid grid-cols-1 md:grid-cols-[60px_1fr] gap-8">
      <div className="w-14 h-14 rounded-full border border-white/10 flex items-center justify-center text-brand-blue">
        {icon}
      </div>
      <div>
        {title && <h2 className="text-2xl font-bold mb-4 tracking-tight">{title}</h2>}
        {paragraphs.map((p, idx) => (
          <p key={idx} className={idx > 0 ? `${paragraphClass} mt-4` : paragraphClass}>{p}</p>
        ))}
      </div>
    </div>
  );
}

function Shield({ size }: { size: number }) {
  return <div className="w-6 h-6 border-2 border-current rounded-sm rotate-45" />;
}
