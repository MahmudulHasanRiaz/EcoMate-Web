import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";

export const revalidate = 300;

export async function generateMetadata() {
  return preFormattedPageMetadata("careers");
}

export default async function CareersPage() {
  return renderPreFormattedPage("careers");
}
