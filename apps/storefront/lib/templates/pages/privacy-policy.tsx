import { Eye, FileText, Database, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { PolicyShell } from "../policy-shell";
import { RichText, TemplateEmptyState } from "../shared";
import { hasText, sectionId } from "../content-utils";
import type { PageMeta } from "../content-utils";

/**
 * CMS-driven Privacy Policy page. Icons are keyed by the section's stable
 * `id` (admin-set; survives a heading rename). Rows written before the id
 * field existed fall back to a slug of the heading, preserving the previous
 * icon assignments for the shipped default headings.
 */
const SECTION_ICONS: Record<string, ReactNode> = {
  "data-collection": <Eye size={24} />,
  "usage-disclosure": <Database size={24} />,
  "security-architecture": <ShieldCheck size={24} />,
};

function getSectionIcon(id: string): ReactNode {
  return SECTION_ICONS[id] ?? <FileText size={24} />;
}

export default function PrivacyPolicyTemplate({
  config,
  pageMeta,
}: {
  config: Record<string, any>;
  storeName?: string;
  pageMeta?: PageMeta;
}) {
  const sections = Array.isArray(config.sections) ? config.sections : [];
  const intro = typeof config?.intro === "string" ? config.intro : "";

  if (sections.length === 0) {
    return <TemplateEmptyState title="Privacy Policy" />;
  }

  return (
    <PolicyShell
      title="Privacy Policy"
      eyebrow="Secure & Private"
      intro={hasText(intro) ? intro : undefined}
      pageMeta={pageMeta}
      variant="dark"
    >
      <div className="space-y-24">
        {sections.map((section, index) => (
          <SectionRenderer key={sectionId(section, index)} section={section} index={index} />
        ))}
      </div>
    </PolicyShell>
  );
}

function SectionRenderer({ section, index }: { section: Record<string, any>; index: number }) {
  const heading = typeof section?.heading === "string" ? section.heading.trim() : "";
  const body = typeof section?.body === "string" ? section.body : "";
  const paragraphs = body
    .replace(/<[^>]*>/g, "\n")
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Gracefully skip fully-empty sections.
  if (!heading && paragraphs.length === 0) return null;

  // Replicate the 4-cell grid layout for any section whose body has exactly
  // 4 paragraphs (matches the current page's design).
  if (paragraphs.length === 4) {
    return (
      <div className="bg-brand-dark p-12 rounded-[40px] border border-white/5">
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
    <div className="grid grid-cols-1 md:grid-cols-[60px_1fr] gap-8">
      <div className="w-14 h-14 rounded-full border border-white/10 flex items-center justify-center text-brand-blue">
        {getSectionIcon(sectionId(section, index))}
      </div>
      <div>
        {heading && (
          <h2 id={sectionId(section, index)} className="text-2xl font-bold mb-4 tracking-tight scroll-mt-24">
            {heading}
          </h2>
        )}
        <RichText body={body} className="text-gray-400 leading-relaxed text-base md:text-lg [&>p]:mb-4" />
      </div>
    </div>
  );
}
