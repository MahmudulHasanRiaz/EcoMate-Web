import type { Combo } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export interface ServerCombosResponse {
  data: Combo[];
  meta: {
    total: number;
    perPage: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface FetchCombosServerOpts {
  cursor?: string;
  perPage?: number;
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  sort?: string;
  order?: string;
}

function buildQuery(params: FetchCombosServerOpts): string {
  const sp = new URLSearchParams();
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.perPage) sp.set("perPage", String(params.perPage));
  if (params.search) sp.set("search", params.search);
  if (params.categoryId) sp.set("categoryId", params.categoryId);
  if (params.isActive !== undefined) sp.set("isActive", String(params.isActive));
  if (params.sort) sp.set("sort", params.sort);
  if (params.order) sp.set("order", params.order);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchCombosServer(
  opts: FetchCombosServerOpts = {},
): Promise<ServerCombosResponse> {
  const url = `${API_URL}/combos${buildQuery(opts)}`;
  const res = await fetch(url, {
    next: { revalidate: 300 },
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch combos: ${res.status}`);
  }
  return res.json() as Promise<ServerCombosResponse>;
}
