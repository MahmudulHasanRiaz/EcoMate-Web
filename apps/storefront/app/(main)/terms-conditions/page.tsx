import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";

export const revalidate = 300;

export async function generateMetadata() {
  return preFormattedPageMetadata("terms-conditions");
}

export default async function TermsConditionsPage() {
  return renderPreFormattedPage("terms-conditions");
}
