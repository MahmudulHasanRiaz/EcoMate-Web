import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";

export const revalidate = 300;

export async function generateMetadata() {
  return preFormattedPageMetadata("shipping-policy");
}

export default async function ShippingPolicyPage() {
  return renderPreFormattedPage("shipping-policy");
}
