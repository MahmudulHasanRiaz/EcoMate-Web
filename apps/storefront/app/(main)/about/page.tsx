import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";

export const revalidate = 300;

export async function generateMetadata() {
  return preFormattedPageMetadata("about");
}

export default async function AboutPage() {
  return renderPreFormattedPage("about");
}
