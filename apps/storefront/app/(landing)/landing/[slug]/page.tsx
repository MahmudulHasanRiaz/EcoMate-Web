import { notFound } from "next/navigation";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import { serverFetch } from "@/lib/api-server";
import LandingTemplateRenderer from "@/components/landing/TemplateRenderer";
import LandingCustomRenderer from "@/components/landing/CustomRenderer";
import type { Metadata } from "next";

export const revalidate = 300;

interface LandingData {
  id: string;
  title: string;
  slug: string;
  pageType: "template" | "custom";
  templateId: string | null;
  sections: any[];
  customHtml: string | null;
  customCss: string | null;
  productIds: string[];
  comboIds: string[];
  trackingJson: Record<string, any>;
}

async function getLanding(slug: string, preview?: boolean): Promise<LandingData | null> {
  try {
    const endpoint = preview
      ? `/landing-pages/preview/${encodeURIComponent(slug)}`
      : `/landing-pages/published/${encodeURIComponent(slug)}`;
    return await serverFetch(endpoint);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page: LandingData | null = await getLanding(slug);
  const config = await getStorefrontConfigServer().catch(() => null);

  if (!page) return {};

  const ogImage = page.trackingJson?.ogImage || config?.branding?.storefrontOgImage;

  return {
    title: `${page.title} — ${config?.store?.name || "Offer"}`,
    description: page.title,
    openGraph: {
      title: page.title,
      description: page.title,
      images: ogImage ? [ogImage] : undefined,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.title,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function LandingPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  const { slug } = params;
  const isPreview = searchParams?.preview === "true";

  const [page, storefrontConfig] = await Promise.all([
    getLanding(slug, isPreview),
    getStorefrontConfigServer().catch(() => null),
  ]);

  if (!page) notFound();

  // Fetch assigned products for template mode
  let products: any[] = [];
  const allProductIds = [...(page.productIds || [])];
  if (page.pageType === "template") {
    page.sections?.forEach((s: any) => {
      if (s.productId) allProductIds.push(s.productId);
      if (s.productIds?.length) allProductIds.push(...s.productIds);
    });
  }
  if (allProductIds.length > 0) {
    const uniqueIds = [...new Set(allProductIds)].slice(0, 12);
    try {
      const res = await serverFetch(`/products?ids=${uniqueIds.join(",")}&isActive=true&perPage=12`);
      products = (res as any)?.data || [];
    } catch {}
  }

  const pixelId = storefrontConfig?.meta?.pixelEnabled ? (storefrontConfig?.meta?.pixelId || "") : "";
  const tiktokCode = storefrontConfig?.tiktok?.pixelEnabled ? (storefrontConfig?.tiktok?.pixelCode || "") : "";

  return (
    <>
      {isPreview && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-center text-xs py-1 font-medium">
          Preview Mode — This page is not published
        </div>
      )}

      {/* Inline tracking — minimal, fires once per event */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            window.EcoMate = window.EcoMate || {};
            window.EcoMate.config = ${JSON.stringify({
              pixelId,
              tiktokCode,
              currency: storefrontConfig?.currency?.code || "BDT",
            })};
            (function() {
              var fired = {};
              window.EcoMate.track = function(event, data) {
                if (fired[event]) { return; }
                fired[event] = true;
                var payload = {
                  eventName: event,
                  eventId: event + '_' + Date.now(),
                  customData: Object.assign({}, data || {}, { url: location.href, source: 'landing' })
                };
                if (navigator.sendBeacon) {
                  navigator.sendBeacon('/api/tracking/events', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
                } else {
                  fetch('/api/tracking/events', {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify(payload), keepalive: true
                  }).catch(function(){});
                }
              };
              window.EcoMate.track('PageView', {});
            })();
          `,
        }}
      />

      {/* Template mode */}
      {page.pageType === "template" && (
        <LandingTemplateRenderer
          sections={page.sections || []}
          products={products}
          primaryColor={(page.trackingJson as any)?.primaryColor}
        />
      )}

      {/* Custom code mode */}
      {page.pageType === "custom" && (
        <LandingCustomRenderer
          html={page.customHtml || ""}
          css={page.customCss || ""}
        />
      )}
    </>
  );
}
