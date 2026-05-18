"use client";

import { useEffect, useState } from "react";
import Script from "next/script";

declare global {
  interface Window {
    fbq?: any;
    _fbq?: any;
    ttq?: any;
  }
}

let _metaId = "";
let _tiktokCode = "";

export function getPixelIds() {
  return { metaId: _metaId, tiktokCode: _tiktokCode };
}

export default function TrackingScripts() {
  const [config, setConfig] = useState<{ metaId: string; tiktokCode: string } | null>(null);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
    fetch(`${apiUrl}/system-settings/storefront`)
      .then((r) => r.json())
      .then((data) => {
        const metaId = data?.meta?.pixelEnabled ? data.meta.pixelId || "" : "";
        const tiktokCode = data?.tiktok?.pixelEnabled ? data.tiktok.pixelCode || "" : "";
        _metaId = metaId;
        _tiktokCode = tiktokCode;
        setConfig({ metaId, tiktokCode });
      })
      .catch(() => {});
  }, []);

  if (!config) return null;

  return (
    <>
      {config.metaId && (
        <>
          <Script id="meta-pixel" strategy="afterInteractive">
            {`
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${config.metaId}');
              fbq('track', 'PageView');
            `}
          </Script>
          <noscript>
            <img height="1" width="1" style={{ display: "none" }}
              src={`https://www.facebook.com/tr?id=${config.metaId}&ev=PageView&noscript=1`}
            />
          </noscript>
        </>
      )}

      {config.tiktokCode && (
        <Script id="tiktok-pixel" strategy="afterInteractive">
          {`
            !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
            ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
            ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
            for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
            ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
            ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";
            var o=n&&n.partner;ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;var r=document.createElement("script");
            r.type="text/javascript";r.async=true;r.src=i+"?sdkid="+e+"&lib="+t;
            var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(r,a)};
            ttq.load('${config.tiktokCode}');
            ttq.page();
          `}
        </Script>
      )}
    </>
  );
}
