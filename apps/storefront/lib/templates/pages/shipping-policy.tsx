import { Fragment } from "react";
import { PolicyShell } from "../policy-shell";
import { RichText, TemplateEmptyState } from "../shared";
import { hasText } from "../content-utils";
import type { PageMeta } from "../content-utils";

interface ShippingSection {
  heading?: string;
  body?: string;
}

/**
 * CMS-driven Shipping Policy page. "Last updated" comes from the CmsPage
 * row (pageMeta), never hardcoded copy. Charge amounts come from the LIVE
 * delivery config first (`deliveryCharge` / `freeDeliveryMin` props, fed by
 * renderPreFormattedPage from the storefront config — the same values
 * checkout uses); the legacy per-page CMS config values are only a fallback
 * when the live config is unconfigured (0). The charge-line rewrite only
 * runs when a charge is actually configured (> 0); otherwise the
 * admin-written body renders verbatim.
 */
export default function ShippingPolicyTemplate({
  config,
  pageMeta,
  deliveryCharge: liveDeliveryCharge,
  freeDeliveryMin: liveFreeDeliveryMin,
}: {
  config: Record<string, any>;
  storeName?: string;
  pageMeta?: PageMeta;
  deliveryCharge?: number;
  freeDeliveryMin?: number;
}) {
  const sections: ShippingSection[] = Array.isArray(config.sections) ? config.sections : [];
  const intro = typeof config?.intro === "string" ? config.intro : "";
  const deliveryCharge =
    typeof liveDeliveryCharge === "number" && liveDeliveryCharge > 0
      ? liveDeliveryCharge
      : Number(config.deliveryCharge) > 0
        ? Number(config.deliveryCharge)
        : 0;
  const freeDeliveryMin =
    typeof liveFreeDeliveryMin === "number" && liveFreeDeliveryMin > 0
      ? liveFreeDeliveryMin
      : Number(config.freeDeliveryMin) > 0
        ? Number(config.freeDeliveryMin)
        : 0;

  if (sections.length === 0) {
    return <TemplateEmptyState title="Shipping Policy" />;
  }

  return (
    <PolicyShell
      title="Shipping Policy"
      eyebrow="Delivery & Shipping"
      intro={hasText(intro) ? intro : undefined}
      pageMeta={pageMeta}
    >
      <div className="max-w-3xl space-y-4 text-[13px] text-gray-600">
        {sections.map((section, i) => {
          const heading = (section?.heading || "").trim();
          const body = section?.body || "";

          // Gracefully skip empty sections.
          if (!hasText(body)) return null;

          return (
            <Fragment key={i}>
              {heading && <h3 className="text-[15px] font-semibold text-gray-800">{heading}</h3>}
              <RichText body={renderChargeLines(body, deliveryCharge, freeDeliveryMin)} />
            </Fragment>
          );
        })}
      </div>
    </PolicyShell>
  );
}

/**
 * Fills the ৳ amounts in shipping-charge lines from the stored config so the
 * page reflects the current delivery charge / free-delivery minimum. Lines
 * that do not match a known pattern are returned unchanged, and when a
 * charge is unconfigured (0) nothing is rewritten.
 */
function renderChargeLines(body: string, deliveryCharge: number, freeDeliveryMin: number): string {
  if (deliveryCharge <= 0 && freeDeliveryMin <= 0) return body;
  return body
    .split("\n")
    .map((line) => {
      if (freeDeliveryMin > 0 && (/free shipping|free delivery/i.test(line) || /over\s*৳/i.test(line))) {
        return line.replace(/৳[\d,]+/, `৳${freeDeliveryMin.toLocaleString()}`);
      }
      if (deliveryCharge > 0 && /flat rate/i.test(line)) {
        return line.replace(/৳[\d,]+/, `৳${deliveryCharge}`);
      }
      return line;
    })
    .join("\n");
}
