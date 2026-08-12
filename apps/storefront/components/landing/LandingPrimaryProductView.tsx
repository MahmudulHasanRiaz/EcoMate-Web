"use client";

import { useEffect, useMemo, useRef } from "react";
import { trackViewContent } from "@/lib/tracking";
import { resolveCatalogId } from "@/lib/catalog-id";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { useAuth } from "@/context/AuthContext";

function activeVariant(p: any) {
  return (p?.variants || []).find((v: any) => v?.isActive) || (p?.variants || [])[0];
}

/**
 * Landing Page Builder — PRIMARY ASSIGNED PRODUCT view signal.
 *
 * A landing/sales page built in the Landing Page Builder is the DEDICATED
 * content surface for its assigned product(s) — the customer is not opening a
 * Product Detail page, the landing page itself IS the product view. So a genuine
 * page load fires ONE ViewContent per primary assigned product.
 *
 * Deliberately NOT fired for:
 *  - passive product grid/list rendering (normal storefront grids emit nothing)
 *  - section product cards / recommendations / related products on the landing
 *    page — those are secondary content, not the page's primary view.
 *
 * Only the top-level ASSIGNED products (`landing.productIds` → primaryProducts)
 * are passed in here. Each primary product fires exactly once per resolved
 * canonical catalog id (ref-guard set). React rerenders, scroll, CTA clicks and
 * unrelated state updates do NOT add events. A genuine assignment change (new
 * primary product) fires one new event with the new catalog id; re-visiting an
 * already-viewed id within the same instance collapses instead. The
 * deterministic event_id inside trackViewContent additionally collapses any
 * accidental re-fire within the same 5s bucket (Browser + CAPI share it).
 *
 * For a variable assigned product the catalog only contains VARIANT items
 * (e.g. CWB-1-40…46), so the first active variant's canonical SKU is used;
 * otherwise the product-level catalog id is used (feed parity via
 * resolveCatalogId).
 */
export default function LandingPrimaryProductView({
  primaryProducts,
}: {
  primaryProducts: any[];
}) {
  const { config } = useStorefrontConfig();
  const { user } = useAuth();
  const firedRef = useRef<Set<string>>(new Set());
  const currency = config?.currency?.code || "BDT";

  // Stable identity of the assigned set: rerenders with the same products keep
  // the same key; a genuine assignment change produces a new key → one new
  // event per newly-assigned catalog id.
  const catalogKey = useMemo(
    () => primaryProducts.map((p) => resolveCatalogId(p, activeVariant(p))).join("|"),
    [primaryProducts],
  );

  useEffect(() => {
    if (!primaryProducts?.length) return;
    for (const p of primaryProducts) {
      if (!p?.id) continue;
      const variant = activeVariant(p);
      const catalogId = resolveCatalogId(p, variant);
      if (!catalogId || firedRef.current.has(catalogId)) continue;
      firedRef.current.add(catalogId);
      const price =
        Number(variant?.price ?? p?.salePrice ?? p?.basePrice ?? p?.price ?? 0) || 0;
      trackViewContent({
        contentId: catalogId,
        contentName: p?.name,
        contentCategory: p?.category,
        value: price,
        currency,
        email: user?.email,
        country: "BD",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogKey, currency, user?.email]);

  return null;
}