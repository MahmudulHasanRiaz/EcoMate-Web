import { Fragment } from "react";
import { Truck } from "lucide-react";

interface ShippingSection {
  heading?: string;
  body?: string;
}

/**
 * CMS-driven Shipping Policy page (fixed design).
 * Renders content entirely from the `config` prop (stored CmsPage config merged
 * over the registry defaults). No data fetching happens here.
 */
export default function ShippingPolicyTemplate({ config }: { config: Record<string, any> }) {
  const sections: ShippingSection[] = Array.isArray(config.sections) ? config.sections : [];
  const deliveryCharge = Number(config.deliveryCharge) > 0 ? Number(config.deliveryCharge) : 60;
  const freeDeliveryMin = Number(config.freeDeliveryMin) > 0 ? Number(config.freeDeliveryMin) : 5000;

  return (
    <div className="max-w-screen-xl mx-auto px-3 md:px-4 py-4 md:py-8">
      <h1 className="text-[18px] md:text-[24px] font-bold text-gray-900 mb-1">Shipping Policy</h1>
      <p className="text-[13px] text-gray-500 mb-6">Last updated: December 2024</p>
      <div className="max-w-3xl space-y-4 text-[13px] text-gray-600">
        {sections.map((section, i) => {
          const heading = (section?.heading || "").trim();
          const bodyParts = (section?.body || "")
            .split("\n\n")
            .map((part) => part.trim())
            .filter(Boolean);

          // Gracefully skip empty sections.
          if (bodyParts.length === 0) return null;

          const content =
            bodyParts.length > 1 ? (
              <ul className="list-disc pl-5 space-y-1">
                {bodyParts.map((part, j) => (
                  <li key={j}>{renderChargeLine(part, deliveryCharge, freeDeliveryMin)}</li>
                ))}
              </ul>
            ) : (
              <p>{renderChargeLine(bodyParts[0], deliveryCharge, freeDeliveryMin)}</p>
            );

          return (
            <Fragment key={i}>
              {heading && <h3 className="text-[15px] font-semibold text-gray-800">{heading}</h3>}
              {content}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Fills the ৳ amounts in shipping-charge lines from the stored config so the
 * page always reflects the current delivery charge / free-delivery minimum.
 * Lines that do not match a known pattern are returned unchanged.
 */
function renderChargeLine(part: string, deliveryCharge: number, freeDeliveryMin: number) {
  if (/free shipping|free delivery/i.test(part) || /over\s*৳/i.test(part)) {
    return part.replace(/৳[\d,]+/, `৳${freeDeliveryMin.toLocaleString()}`);
  }
  if (/flat rate/i.test(part)) {
    return part.replace(/৳[\d,]+/, `৳${deliveryCharge}`);
  }
  return part;
}
