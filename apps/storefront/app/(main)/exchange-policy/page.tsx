import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";

export const revalidate = 300;

export async function generateMetadata() {
  return preFormattedPageMetadata("exchange-policy");
}

export default async function ExchangePolicyPage() {
  return renderPreFormattedPage("exchange-policy");
}
