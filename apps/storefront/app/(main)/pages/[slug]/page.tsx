import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import DOMPurify from "isomorphic-dompurify";
import { getCmsPageBySlug } from "@/lib/api/cms-pages";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import { pageMetadata } from "@/lib/metadata";
import { formatPageDate } from "@/lib/templates/content-utils";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await getCmsPageBySlug(slug);
  if (!page) return pageMetadata("Page Not Found", "The page you are looking for does not exist.");
  const config = await getStorefrontConfigServer().catch(() => null);
  const storeName = config?.store.name || "Store";
  return pageMetadata(
    `${page.title}`,
    page.metaDescription || `${page.title} — ${storeName}.`,
    undefined,
    page.ogImage || undefined,
  );
}

export const revalidate = 3600;

export default async function CmsPageView({ params }: PageProps) {
  const { slug } = await params;
  const page = await getCmsPageBySlug(slug);
  if (!page) notFound();

  const config = await getStorefrontConfigServer().catch(() => null);
  const storeName = config?.store.name || "Store";
  const updated = formatPageDate(page.updatedAt);
  const effective = formatPageDate(page.effectiveDate);

  return (
    <div className="bg-gray-50 min-h-screen pb-24">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 pt-10 pb-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-brand-blue hover:opacity-80 mb-6"
          >
            <ArrowLeft size={14} /> Back to {storeName}
          </Link>
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-brand-blue/10 text-brand-blue">
              <FileText size={20} />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-brand-blue/80">Legal &amp; Information</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-gray-900 tracking-tight leading-[1.05]">{page.title}</h1>
        </div>
      </div>

      <article className="max-w-4xl mx-auto px-4 py-12">
        <div
          className="cms-content bg-white rounded-2xl border border-gray-100 p-8 md:p-12 shadow-sm"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(page.content) }}
        />
        {(updated || effective || page.version) && (
          <div className="mt-10 pt-6 border-t border-gray-100 text-[12px] text-gray-400">
            {updated && <span>Last updated: {updated}</span>}
            {effective && <span> · Effective: {effective}</span>}
            {page.version ? <span> · Version {page.version}</span> : null}
          </div>
        )}
      </article>

      <style>{`
        .cms-content h1 { font-size: 2rem; font-weight: 800; margin: 2rem 0 1rem; color: var(--color-brand-dark); }
        .cms-content h2 { font-size: 1.5rem; font-weight: 700; margin: 1.75rem 0 0.75rem; color: var(--color-brand-dark); }
        .cms-content h3 { font-size: 1.25rem; font-weight: 700; margin: 1.5rem 0 0.5rem; color: var(--color-brand-dark); }
        .cms-content h4 { font-size: 1.1rem; font-weight: 600; margin: 1.25rem 0 0.5rem; color: var(--color-brand-dark); }
        .cms-content p { margin: 0 0 1rem; line-height: 1.75; color: color-mix(in srgb, var(--color-brand-dark) 65%, transparent); font-size: 15px; }
        .cms-content ul, .cms-content ol { margin: 0 0 1rem 1.25rem; color: color-mix(in srgb, var(--color-brand-dark) 65%, transparent); line-height: 1.75; font-size: 15px; }
        .cms-content ul { list-style: disc; }
        .cms-content ol { list-style: decimal; }
        .cms-content li { margin-bottom: 0.4rem; }
        .cms-content a { color: var(--color-brand-blue); text-decoration: underline; text-underline-offset: 3px; }
        .cms-content a:hover { color: var(--color-brand-blue-dark); }
        .cms-content strong { color: var(--color-brand-dark); font-weight: 700; }
        .cms-content blockquote { border-left: 4px solid var(--color-brand-blue); padding-left: 1rem; color: color-mix(in srgb, var(--color-brand-dark) 65%, transparent); font-style: italic; margin: 1.25rem 0; }
        .cms-content code { background: var(--color-brand-border); padding: 0.15rem 0.4rem; border-radius: 0.25rem; font-size: 0.9em; }
        .cms-content pre { background: var(--color-brand-dark); color: var(--color-brand-bg); padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 1rem 0; }
        .cms-content table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
        .cms-content th, .cms-content td { border: 1px solid var(--color-brand-border); padding: 0.5rem 0.75rem; text-align: left; }
        .cms-content th { background: var(--color-brand-bg); font-weight: 600; }
        .cms-content hr { border: none; border-top: 1px solid var(--color-brand-border); margin: 2rem 0; }
      `}</style>
    </div>
  );
}
