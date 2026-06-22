import { notFound } from "next/navigation";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import { serverFetch } from "@/lib/api-server";
import LandingTemplateRenderer from "@/components/landing/TemplateRenderer";
import LandingCustomRenderer from "@/components/landing/CustomRenderer";

export const revalidate = 300;
export const dynamic = "force-dynamic";

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

async function getLanding(slug: string): Promise<LandingData | null> {
  try {
    return await serverFetch(`/landing-pages/published/${encodeURIComponent(slug)}`);
  } catch {
    return null;
  }
}

export default async function LandingPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const [page, storefrontConfig] = await Promise.all([
    getLanding(slug),
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
                  navigator.sendBeacon('/api/tracking/events', JSON.stringify(payload));
                } else {
                  fetch('/api/tracking/events', {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify(payload), keepalive: true
                  }).catch(function(){});
                }
              };
              /* Fire PageView once */
              window.EcoMate.track('PageView', {});
            })();
          `,
        }}
      />

      {/* Template mode — receives pre-fetched products */}
      {page.pageType === "template" && (
        <LandingTemplateRenderer
          sections={page.sections || []}
          products={products}
        />
      )}

      {/* Custom code mode — raw HTML */}
      {page.pageType === "custom" && (
        <LandingCustomRenderer
          html={page.customHtml || ""}
          css={page.customCss || ""}
        />
      )}
    </>
  );
}
