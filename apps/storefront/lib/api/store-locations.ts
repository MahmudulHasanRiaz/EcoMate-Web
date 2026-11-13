import { serverFetch } from "../api-server";

export type StoreLocationType = 'SHOWROOM' | 'BRANCH' | 'OFFICE';

export interface StoreSocial {
  platform: string;
  url: string;
}

export interface StoreLocation {
  id: string;
  name: string;
  type: StoreLocationType;
  address: string;
  city: string | null;
  district: string | null;
  phone: string | null;
  email: string | null;
  hours: string | null;
  mapUrl: string | null;
  socials: StoreSocial[] | null;
  photo: string | null;
  comingSoon: boolean;
  openingDate: string | null;
  isActive: boolean;
  sortOrder: number;
}

/** Public storefront list: active locations only, in admin sort order. */
export async function getStoreLocations(): Promise<StoreLocation[]> {
  return serverFetch<StoreLocation[]>('/store-locations', {
    next: { revalidate: 300 },
  }).catch(() => []);
}
