"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';

const STORAGE_KEY = 'ecomate_wishlist';

interface WishlistContextType {
  ids: string[];
  isWishlisted: (id: string) => boolean;
  toggle: (id: string) => void;
  add: (id: string) => void;
  remove: (id: string) => void;
}

const WishlistContext = createContext<WishlistContextType | undefined>(undefined);

function loadIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveIds(ids: string[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>(() => loadIds());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveIds(ids);
  }, [ids, loaded]);

  const isWishlisted = (id: string) => ids.includes(id);
  const add = (id: string) => setIds(prev => prev.includes(id) ? prev : [...prev, id]);
  const remove = (id: string) => setIds(prev => prev.filter(i => i !== id));
  const toggle = (id: string) => setIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  return (
    <WishlistContext.Provider value={{ ids, isWishlisted, toggle, add, remove }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error('useWishlist must be used within WishlistProvider');
  return ctx;
}
