import { apiClient } from '@/lib/api-client';

export interface FeedConfig {
  id: string;
  platform: string;
  secureToken: string;
  isActive: boolean;
  excludeOutOfStock: boolean;
  minPriceFilter: number | null;
  googleProductCategory: string | null;
  lastFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeedLog {
  id: string;
  platform: string;
  ipAddress: string;
  userAgent: string;
  statusCode: number;
  durationMs: number;
  fetchedAt: string;
}

export interface FeedPreviewItem {
  id: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImages: number;
  availability: string;
  price: number;
  salePrice: number | null;
  brand: string;
  productType: string | null;
  color?: string;
  size?: string;
  gender?: string;
  material?: string;
  pattern?: string;
}

export interface FeedPreview {
  platform: string;
  googleProductCategory: string | null;
  totalProducts: number;
  totalItems: number;
  items: FeedPreviewItem[];
}

export const feedsApi = {
  list: () =>
    apiClient.get<FeedConfig[]>('/v1/feeds/config').then((r) => r.data),

  create: (data: { platform: string }) =>
    apiClient.post<FeedConfig>('/v1/feeds/config', data).then((r) => r.data),

  update: (id: string, data: Partial<FeedConfig>) =>
    apiClient
      .post<FeedConfig>(`/v1/feeds/config/${id}`, data)
      .then((r) => r.data),

  regenerateToken: (id: string) =>
    apiClient
      .post<FeedConfig>(`/v1/feeds/config/${id}/regenerate-token`)
      .then((r) => r.data),

  logs: (platform?: string) =>
    apiClient
      .get<FeedLog[]>('/v1/feeds/logs', { params: { platform } })
      .then((r) => r.data),

  preview: (id: string) =>
    apiClient
      .get<FeedPreview>(`/v1/feeds/config/${id}/preview`)
      .then((r) => r.data),

  taxonomy: () =>
    apiClient
      .get<{ id: number; path: string }[]>('/v1/feeds/taxonomy')
      .then((r) => r.data),
};
