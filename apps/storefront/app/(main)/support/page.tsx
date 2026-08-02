import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";

export const revalidate = 300;

export async function generateMetadata() {
  return preFormattedPageMetadata("contact");
}

export default async function SupportPage() {
  return renderPreFormattedPage("contact");
}
