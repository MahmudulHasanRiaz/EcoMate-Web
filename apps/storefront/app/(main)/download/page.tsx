import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";

export const revalidate = 300;

export async function generateMetadata() {
  return preFormattedPageMetadata("download");
}

export default async function DownloadPage() {
  return renderPreFormattedPage("download");
}
