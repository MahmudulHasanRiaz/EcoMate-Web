import { getStoreLocations } from "@/lib/api/store-locations";
import { pageMetadata } from "@/lib/metadata";
import StoresTemplate from "@/lib/templates/pages/stores";

export const revalidate = 300;

export async function generateMetadata() {
  return pageMetadata(
    "Stores",
    "Visit our showrooms, branches and offices — addresses, hours and directions.",
    "/stores",
  );
}

export default async function StoresPage() {
  const locations = await getStoreLocations();
  return <StoresTemplate locations={locations} />;
}
