import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";

export const revalidate = 300;

export async function generateMetadata() {
  return preFormattedPageMetadata("stores");
}

export default async function StoresPage() {
  return renderPreFormattedPage("stores");
}
