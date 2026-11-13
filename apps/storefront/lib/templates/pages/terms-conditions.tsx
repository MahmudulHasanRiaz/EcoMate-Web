import { Fragment } from "react";
import { AlertCircle } from 'lucide-react';
import { PolicyShell } from "../policy-shell";
import { RichText, TemplateEmptyState } from "../shared";
import { hasText, sectionId } from "../content-utils";
import type { PageMeta } from "../content-utils";

interface TermsSection {
  heading?: string;
  body?: string;
  /** When true, the section renders as the highlighted callout card.
      Rows written before this field existed carry no highlight — see the
      legacy fallback below. */
  highlight?: boolean;
}

export default function TermsConditionsTemplate({
  config,
  pageMeta,
}: {
  config: Record<string, any>;
  storeName?: string;
  pageMeta?: PageMeta;
}) {
  const sections: TermsSection[] = (Array.isArray(config?.sections) ? config.sections : []).filter(
    (s: any) =>
      s &&
      typeof s === "object" &&
      ((typeof s.heading === "string" && s.heading.trim().length > 0) ||
        (typeof s.body === "string" && s.body.trim().length > 0))
  );
  const intro = typeof config?.intro === "string" ? config.intro : "";

  if (!sections.length) {
    return <TemplateEmptyState title="Terms & Conditions" />;
  }

  // Semantic callout: once any section is explicitly highlighted, only
  // highlighted sections are callouts. Until then (rows written before the
  // highlight field existed) the last section renders as the callout, as
  // the old design did, so an existing tenant's page is unchanged.
  const hasExplicitHighlight = sections.some((s) => s?.highlight === true);
  const calloutSections = hasExplicitHighlight
    ? sections.filter((s) => s.highlight === true)
    : sections.length > 1
      ? [sections[sections.length - 1]]
      : [];
  const contentSections = hasExplicitHighlight
    ? sections.filter((s) => !s.highlight)
    : sections.length > 1
      ? sections.slice(0, -1)
      : sections;

  return (
    <PolicyShell
      title="Terms & Conditions"
      eyebrow="Legal Agreement"
      intro={hasText(intro) ? intro : undefined}
      pageMeta={pageMeta}
      wide
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        <div className="lg:col-span-4">
          <nav aria-label="Terms sections" className="sticky top-24 space-y-4">
            {sections.map((section, index) => {
              const id = sectionId(section, index);
              const label = (section.heading || "").trim() || `Section ${index + 1}`;
              return (
                <a
                  key={id}
                  href={`#${id}`}
                  className="w-full flex items-center gap-6 p-4 rounded-2xl transition-all bg-white shadow-xl shadow-gray-200/50 hover:bg-white"
                >
                  <span className="font-mono text-xs font-bold text-brand-blue">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm font-bold tracking-tight text-gray-900">{label}</span>
                </a>
              );
            })}
          </nav>
        </div>

        <div className="lg:col-span-8">
          <div className="prose prose-gray prose-lg max-w-none text-gray-600">
            {contentSections.map((section) => {
              const id = sectionId(section, sections.indexOf(section));
              return (
                <Fragment key={id}>
                  {section.heading && (
                    <h3 id={id} className="text-2xl font-bold text-gray-900 mb-6 scroll-mt-24">
                      {section.heading}
                    </h3>
                  )}
                  <RichText body={section.body || ""} className="[&>p]:mb-8" />
                </Fragment>
              );
            })}

            {calloutSections.map((section) => {
              const id = sectionId(section, sections.indexOf(section));
              return (
                <div key={id} className="bg-white p-10 rounded-[32px] border border-gray-200 mt-16 shadow-sm">
                  {section.heading && (
                    <h4 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <AlertCircle className="text-brand-blue" size={20} />
                      {section.heading}
                    </h4>
                  )}
                  <RichText body={section.body || ""} className="text-[15px] leading-relaxed [&>p]:mb-4" />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </PolicyShell>
  );
}
