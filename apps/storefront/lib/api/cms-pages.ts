import { serverFetch } from "../api-server";

export interface CmsPageSummary {
  id: string;
  slug: string;
  title: string;
}

export interface CmsPage {
  id: string;
  slug: string;
  title: string;
  content: string;
  isActive: boolean;
  showInFooter: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export async function getFooterCmsPages(): Promise<CmsPageSummary[]> {
  return serverFetch<CmsPageSummary[]>("/cms-pages/footer", {
    next: { revalidate: 300 },
  }).catch(() => []);
}

export async function getCmsPageBySlug(slug: string): Promise<CmsPage | null> {
  try {
    return await serverFetch<CmsPage>(`/cms-pages/slug/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
    });
  } catch {
    return null;
  }
}
