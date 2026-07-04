"use client";

import { useEffect } from "react";
import Script from "next/script";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { setPixelIds, setTrackingConfig } from "@/lib/tracking";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

export default function TrackingScripts() {
  const { config } = useStorefrontConfig();
  const metaId = config.meta.pixelEnabled ? config.meta.pixelId : "";
  const tiktokCode = config.tiktok.pixelEnabled ? config.tiktok.pixelCode : "";
  const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || '';
  const gaAdsConversionId = process.env.NEXT_PUBLIC_GA_ADS_CONVERSION_ID || '';
  const hasAny = !!(metaId || tiktokCode || gaMeasurementId);

  useEffect(() => {
    setPixelIds(metaId, tiktokCode);
    setTrackingConfig(config.meta.purchaseMode || 'instant', config.tiktok.purchaseMode || 'instant');
  }, [metaId, tiktokCode, config.meta.purchaseMode, config.tiktok.purchaseMode]);

  useEffect(() => {
    if (metaId) (window as any).__META_ID = metaId;
    if (tiktokCode) (window as any).__TIKTOK_CODE = tiktokCode;
  }, [metaId, tiktokCode]);

  // যদি কোনো আইডি না থাকে, তবে কিছুই রেন্ডার করব না
  if (!hasAny) return null;

  return (
    <>
      <Script id="app-tracking-init" strategy="lazyOnload"
        dangerouslySetInnerHTML={{
          __html: `
          (function() {
            const metaId = ${JSON.stringify(metaId)};
            const tiktokCode = ${JSON.stringify(tiktokCode)};
            const gaId = ${JSON.stringify(gaMeasurementId)};

            // মেটা পিক্সেল
            if (metaId && !window.fbq) {
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              
              fbq('init', metaId);
              fbq('track', 'PageView');
            }

            // টিকটক পিক্সেল
            if (tiktokCode && !window.ttq) {
              !function(w,d,t){
                w.TiktokAnalyticsObject=t;
                var ttq=w[t]=w[t]||[];
                ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
                ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
                for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
                ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
                ttq.load=function(e,n){
                  var i="https://analytics.tiktok.com/i18n/pixel/events.js";
                  var o=n&&n.partner;ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;
                  var r=document.createElement("script");r.type="text/javascript";r.async=true;r.src=i+"?sdkid="+e+"&lib="+t;
                  var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(r,a);
                };
              }(window,document,'ttq');
              
              ttq.load(tiktokCode);
              ttq.page();
            }

            // Google gtag.js (GA4 + Google Ads)
            if (gaId && !window.gtag) {
              window.dataLayer = window.dataLayer || [];
              window.gtag = function(){window.dataLayer.push(arguments);};
              window.gtag('js', new Date());
              window.gtag('config', gaId, { send_page_view: true });
              ${gaAdsConversionId ? `window.gtag('config', ${JSON.stringify(gaAdsConversionId)});` : ''}

              var s = document.createElement('script');
              s.async = true;
              s.src = 'https://www.googletagmanager.com/gtag/js?id=' + gaId;
              var a = document.getElementsByTagName('script')[0];
              a.parentNode.insertBefore(s, a);
            }

            // আমাদের তৈরি কিউ ফ্লাশ করো
            if (window.__flushTrackingQueue) {
              window.__flushTrackingQueue();
            }
          })();
        `}}
      />
    </>
  );
}
