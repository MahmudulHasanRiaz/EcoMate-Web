import Link from "next/link";
import { FileText } from "lucide-react";
import DOMPurify from "isomorphic-dompurify";
import { richTextToHtml } from "./content-utils";

/**
 * Renders an admin-edited rich-text body (HTML from the RichTextEditor, or
 * legacy plain text) as sanitized HTML. Plain text is paragraph-wrapped by
 * richTextToHtml first; HTML is sanitized here before it reaches the DOM.
 */
export function RichText({
  body,
  className,
}: {
  body: string;
  className?: string;
}) {
  const html = richTextToHtml(body || "");
  if (!html) return null;
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  );
}

/**
 * Honest empty state for a template page with no real configured content.
 * Never a blank white hole, never fake content: it says the page is not set
 * up yet and points the visitor somewhere real.
 */
export function TemplateEmptyState({
  title,
  message,
}: {
  title: string;
  message?: string;
}) {
  return (
    <div className="bg-white min-h-[60vh] flex items-center justify-center px-4 py-24">
      <div className="max-w-md w-full text-center border border-dashed border-gray-200 rounded-3xl px-8 py-14">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-blue/10 text-brand-blue mb-6">
          <FileText size={28} />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">{title}</h1>
        <p className="text-gray-500 text-[15px] leading-relaxed mb-8">
          {message || "This page hasn't been set up yet. Please check back soon."}
        </p>
        <Link
          href="/"
          className="inline-block bg-brand-blue text-white px-8 py-3 rounded-full font-bold text-sm hover:opacity-90 transition-opacity"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
