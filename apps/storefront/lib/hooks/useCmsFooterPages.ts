"use client";

import { useEffect, useState } from "react";
import apiClient from "../api-client";

export interface CmsFooterPage {
  id: string;
  slug: string;
  title: string;
}

export function useCmsFooterPages(): CmsFooterPage[] {
  const [pages, setPages] = useState<CmsFooterPage[]>([]);
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<CmsFooterPage[]>("/cms-pages/footer")
      .then(({ data }) => {
        if (!cancelled) setPages(data || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return pages;
}
