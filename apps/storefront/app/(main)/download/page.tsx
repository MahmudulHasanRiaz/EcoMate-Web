import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import DownloadContent from "./DownloadContent";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const config = await getStorefrontConfigServer();
    return pageMetadata(
      `Download ${config.store.name} App`,
      `Get the official ${config.store.name} mobile app. Experience faster checkout, order tracking, and exclusive offers on your phone.`
    );
  } catch {
    return pageMetadata("Download App", "Get the official mobile app.");
  }
}

export default function DownloadPage() {
  return <DownloadContent />;
}
