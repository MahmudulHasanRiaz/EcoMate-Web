import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";

export const revalidate = 300;

export async function generateMetadata() {
  return preFormattedPageMetadata("delivery-areas");
}

export default async function DeliveryAreasPage() {
  return renderPreFormattedPage("delivery-areas");
}
