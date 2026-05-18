"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { setPixelIds } from "@/lib/tracking";

declare global {
  interface Window {
    fbq?: any;
    _fbq?: any;
    ttq?: any;
    __flushTrackingQueue?: () => void;
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export default function TrackingScripts() {
  const [loaded, setLoaded] = useState(false);
  const [metaId, setMetaId] = useState("");
  const [tiktokCode, setTiktokCode] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/system-settings/storefront`)
      .then((r) => r.json())
      .then((data) => {
        const mid = data?.meta?.pixelEnabled ? data.meta.pixelId || "" : "";
        const ttc = data?.tiktok?.pixelEnabled ? data.tiktok.pixelCode || "" : "";
        setMetaId(mid);
        setTiktokCode(ttc);
        setPixelIds(mid, ttc);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  return (
    <>
      {metaId && (
        <>
          <Script id="meta-pixel" strategy="afterInteractive">
            {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaId}');fbq('track','PageView');if(window.__flushTrackingQueue){window.__flushTrackingQueue();}`}
          </Script>
          <noscript>
            <img height="1" width="1" style={{ display: "none" }}
              src={`https://www.facebook.com/tr?id=${metaId}&ev=PageView&noscript=1`}
            />
          </noscript>
        </>
      )}

      {tiktokCode && (
        <Script id="tiktok-pixel" strategy="afterInteractive">
          {`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";var o=n&&n.partner;ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;var r=document.createElement("script");r.type="text/javascript";r.async=true;r.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(r,a)};ttq.load('${tiktokCode}');ttq.page();if(window.__flushTrackingQueue){window.__flushTrackingQueue();}`}
        </Script>
      )}
    </>
  );
}
