import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";

export const revalidate = 300;

export async function generateMetadata() {
  return preFormattedPageMetadata("privacy-policy");
}

export default async function PrivacyPolicyPage() {
  return renderPreFormattedPage("privacy-policy");
}
