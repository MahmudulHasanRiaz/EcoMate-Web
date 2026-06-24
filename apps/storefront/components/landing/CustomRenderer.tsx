"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LandingOrderProvider, type OrderLineItem } from "./LandingOrderContext";
import { CheckoutFormSection } from "./TemplateRenderer";

/**
 * EcoMate SDK — injected as inline script BEFORE user HTML.
 * Provides controlled API surface: EcoMate.products, EcoMate.track(), EcoMate.checkout.submit().
 * Blocks dangerous APIs: eval, localStorage, sessionStorage, cookies.
 */
function EcoMateSDK({ products, pixelId, tiktokCode, currency }: {
  products: any[];
  pixelId: string;
  tiktokCode: string;
  currency: string;
}) {
  const code = `
(function(){
  window.EcoMate = window.EcoMate || {};
  window.EcoMate.version = '1.0';
  window.EcoMate.config = ${JSON.stringify({ pixelId, tiktokCode, currency })};
  window.EcoMate.products = ${JSON.stringify(products || [])};
  window.EcoMate.theme = { primary: '#4f46e5', primaryDark: '#3730a3', currency: '৳' };

  /* Tracking — fire-once per event per page visit */
  var _fired = {};
  window.EcoMate.track = function(e,d) {
    if(_fired[e]) return; _fired[e]=true;
    var p={eventName:e,eventId:e+'_'+Date.now(),customData:Object.assign({},d||{},{url:location.href,source:'landing'})};
    if(navigator.sendBeacon){navigator.sendBeacon('/api/tracking/events',new Blob([JSON.stringify(p)],{type:'application/json'}));}
    else{fetch('/api/tracking/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p),keepalive:true}).catch(function(){});}
  };
  if(!window.__ecoMatePageView){window.__ecoMatePageView=true;window.EcoMate.track('PageView',{});}

  /* Checkout SDK — AI code calls this instead of raw fetch to /api/orders */
  window.EcoMate.checkout = { submit: function(d) {
    return fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      items:d.items||[],guestName:d.name||'',guestPhone:d.phone||'',
      shippingAddress:{fullAddress:d.address||'',deliveryZone:d.deliveryZone||''},
      paymentOptionType:d.payment||'CASH_ON_DELIVERY',gatewayCode:d.gatewayCode||'cod'
    })}).then(function(r){return r.json().then(function(b){if(!r.ok)throw new Error(b.message||'Order failed');return b;});});
  }};

  /* Security: block dangerous APIs */
  try{Object.defineProperty(window,'eval',{get:function(){return undefined;},set:function(){}});
  Object.defineProperty(window,'localStorage',{get:function(){return undefined;},set:function(){}});
  Object.defineProperty(window,'sessionStorage',{get:function(){return undefined;},set:function(){}});
  document.__defineGetter__('cookie',function(){return '';});
  document.__defineSetter__('cookie',function(){});}catch(e){}
})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

function CustomContentWithPortal({ html, css }: { html: string; css?: string | null }) {
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.getElementById("ecomate-checkout-mount");
    if (el) setMountNode(el);
  }, [html]);

  return (
    <>
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <div id="landing-root" className="landing-custom-content" dangerouslySetInnerHTML={{ __html: html }} />
      {mountNode && createPortal(
        <CheckoutFormSection section={{ title: "Complete Your Order", type: "checkout-form" }} index={0} />,
        mountNode
      )}
    </>
  );
}

export default function LandingCustomRenderer({
  html,
  css,
  products = [],
  pixelId = '',
  tiktokCode = '',
  currency = 'BDT',
}: {
  html: string;
  css?: string | null;
  products?: any[];
  pixelId?: string;
  tiktokCode?: string;
  currency?: string;
}) {
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
      <EcoMateSDK products={products} pixelId={pixelId} tiktokCode={tiktokCode} currency={currency} />
      <CustomContentWithPortal html={html} css={css} />
    </LandingOrderProvider>
  );
}
