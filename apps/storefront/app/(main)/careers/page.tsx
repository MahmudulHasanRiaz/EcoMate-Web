import { notFound } from "next/navigation";
import { getCmsPageBySlug } from "@/lib/api/cms-pages";
import { getJobs } from "@/lib/api/jobs";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import { hasLicenseFeature } from "@/lib/api/storefront-config";
import CareersTemplate from "@/lib/templates/pages/careers";
import { preFormattedPageMetadata } from "@/lib/templates/render-page";

export const revalidate = 300;

export async function generateMetadata() {
  return preFormattedPageMetadata("careers");
}

export default async function CareersPage() {
  const page = await getCmsPageBySlug("careers");
  if (page && !page.isActive) notFound();

  // CMS hero/benefits text stays; open roles come from GET /jobs, never
  // from the deprecated CMS config.jobs array.
  const config = (page?.config ?? {}) as Record<string, any>;
  const { data: jobs } = await getJobs().catch(() => ({ data: [] as never[] }));

  // Licence-fetch failure yields features: [] — the safe default is the
  // mailto CTA, so a KeyMate outage never blanks the page.
  const storefrontConfig = await getStorefrontConfigServer().catch(() => ({ licenseFeatures: [] as string[] }));
  const canApply = hasLicenseFeature(storefrontConfig, 'admin_hr_careers');

  return <CareersTemplate config={config} jobs={jobs} canApply={canApply} />;
}
