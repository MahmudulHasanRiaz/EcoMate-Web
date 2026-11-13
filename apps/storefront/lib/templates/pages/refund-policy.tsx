import { AlertCircle } from 'lucide-react';
import { PolicyShell } from "../policy-shell";
import { RichText, TemplateEmptyState } from "../shared";
import { hasText } from "../content-utils";
import type { PageMeta } from "../content-utils";

/**
 * CMS-driven Refund Policy page. The amber notice box is an editable
 * section (`config.notice` — title + body) instead of hardcoded copy: the
 * old hardcoded 24h/perishable warning contradicted this page's own refund
 * timeline, so with neutral defaults there is no notice at all until an
 * admin writes one.
 */
export default function RefundPolicyTemplate({
  config,
  pageMeta,
}: {
  config: Record<string, any>;
  storeName?: string;
  pageMeta?: PageMeta;
}) {
  const sections = Array.isArray(config.sections) ? config.sections : [];
  const intro = typeof config?.intro === "string" ? config.intro : "";
  const noticeTitle = typeof config?.notice?.title === "string" ? config.notice.title : "";
  const noticeBody = typeof config?.notice?.body === "string" ? config.notice.body : "";
  const contactEmail = typeof config.contactEmail === "string" ? config.contactEmail : "";

  if (sections.length === 0 && !hasText(noticeBody) && !hasText(contactEmail)) {
    return <TemplateEmptyState title="Refund Policy" />;
  }

  return (
    <PolicyShell
      title="Refund Policy"
      eyebrow="Returns & Refunds"
      intro={hasText(intro) ? intro : undefined}
      pageMeta={pageMeta}
    >
      <div className="space-y-12">
        {sections.map((section, index) => (
          <PolicySection
            key={index}
            number={String(index + 1).padStart(2, "0")}
            title={typeof section?.heading === "string" ? section.heading : ""}
            body={typeof section?.body === "string" ? section.body : ""}
          />
        ))}

        {/* Notice Box — editable section, rendered only when configured */}
        {hasText(noticeBody) && (
          <div className="bg-amber-50 border-l-4 border-amber-400 p-8 rounded-r-2xl">
            <div className="flex items-start gap-4">
              <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={24} />
              <div>
                {noticeTitle && <h4 className="font-bold text-amber-900 mb-2">{noticeTitle}</h4>}
                <RichText body={noticeBody} className="text-amber-800/80 text-[15px] leading-relaxed" />
              </div>
            </div>
          </div>
        )}

        {contactEmail && (
          <div className="pt-12 text-center">
            <p className="text-gray-400 text-sm mb-6 font-mono uppercase tracking-widest">Questions?</p>
            <a href={`mailto:${contactEmail}`} className="text-brand-blue font-bold text-xl hover:underline">{contactEmail}</a>
          </div>
        )}
      </div>
    </PolicyShell>
  );
}

function PolicySection({ number, title, body }: { number: string, title: string, body: string }) {
  if (!hasText(title) && !hasText(body)) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[100px_1fr] gap-4">
      <div className="font-mono text-4xl font-black text-gray-100 hidden md:block">{number}</div>
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">{title}</h2>
        <RichText body={body} className="text-gray-600 leading-relaxed text-[15px] [&>p]:mb-4" />
      </div>
    </div>
  );
}
