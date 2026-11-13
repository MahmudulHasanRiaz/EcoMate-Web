import Link from 'next/link';
import { getFooterCmsPages } from "@/lib/api/cms-pages";

/**
 * CMS content pages flagged "Show in Footer" (public footer endpoint —
 * previously zero callers). Async server component: it is rendered by the
 * (sync) Footer inside a Suspense boundary, so the footer shell never waits
 * on the CMS fetch. Template pages link to /<slug>, content pages to
 * /pages/<slug>; urls already present in the column are skipped.
 */
export default async function CmsFooterLinks({ excludeUrls }: { excludeUrls: string[] }) {
  const pages = await getFooterCmsPages();
  const excluded = new Set(excludeUrls);
  const items = pages
    .map((p) => ({
      id: p.id,
      label: p.title,
      url: p.type === 'template' ? `/${p.slug}` : `/pages/${p.slug}`,
    }))
    .filter((i) => !excluded.has(i.url));
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => (
        <li key={`cms-${item.id}`}>
          <Link href={item.url} className="text-[12px] text-gray-500 hover:text-brand-blue transition-colors text-left">
            {item.label}
          </Link>
        </li>
      ))}
    </>
  );
}
