"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LandingOrderProvider, type OrderLineItem } from "./LandingOrderContext";
import { CheckoutFormSection } from "./TemplateRenderer";

function CustomContentWithPortal({ html, css }: { html: string; css?: string | null }) {
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Look for our special mount ID in the injected HTML
    const el = document.getElementById("ecomate-checkout-mount");
    if (el) {
      setMountNode(el);
    }
  }, [html]);

  return (
    <>
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <div
        className="landing-custom-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {mountNode && createPortal(<CheckoutFormSection section={{ title: "Complete Your Order", type: "checkout-form" }} index={0} />, mountNode)}
    </>
  );
}

export default function LandingCustomRenderer({
  html,
  css,
  products = [],
}: {
  html: string;
  css?: string | null;
  products?: any[];
}) {
  // Initialize order items from products so the checkout form knows what is being purchased
  const initialItems: OrderLineItem[] = (products || []).map((p: any) => {
    const firstVariant = p.variants?.find((v: any) => v.isActive);
    return {
      productId: p.id,
      productName: p.name,
      productImage: p.images?.[0],
      variantId: firstVariant?.id,
      variantLabel: firstVariant?.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / '),
      quantity: products?.length === 1 ? 1 : 0,
      price: parseFloat(String(firstVariant?.price || p.salePrice || p.basePrice || p.price || 0)),
      maxStock: firstVariant?.stock ?? p.stock ?? 999,
    };
  });

  return (
    <LandingOrderProvider initialItems={initialItems}>
      <CustomContentWithPortal html={html} css={css} />
    </LandingOrderProvider>
  );
}
