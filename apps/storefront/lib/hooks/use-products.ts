"use client";

import { useState, useEffect } from "react";
import { getProducts, getFeaturedProducts, getCategories } from "../api/products";
import { getCombos } from "../api/combos";
import type { Product, Category, Combo } from "../types";

export function useFeaturedProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    getFeaturedProducts().then(setProducts).catch(() => {}).finally(() => setLoading(false));
  }, []);
  return { products, loading };
}

export function useProducts(params?: { page?: number; perPage?: number; search?: string; categoryId?: string; sort?: string; order?: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) setLoading(true);
    });
    getProducts({ isActive: true, ...params }).then((res) => {
      if (active) {
        setProducts(res.data);
        setMeta(res.meta);
      }
    }).catch(() => {}).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.page, params?.perPage, params?.search, params?.categoryId, params?.sort, params?.order]);
  return { products, meta, loading };
}

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    getCategories().then(setCategories).catch(() => {}).finally(() => setLoading(false));
  }, []);
  return { categories, loading };
}

export function useCombos() {
  const [combos, setCombos] = useState<Combo[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    getCombos({ isActive: true }).then((res) => setCombos(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  return { combos, loading };
}
