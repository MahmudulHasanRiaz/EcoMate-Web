import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";

export const revalidate = 300;

export async function generateMetadata() {
  return preFormattedPageMetadata("faq");
}

export default async function FaqPage() {
  return renderPreFormattedPage("faq");
}
