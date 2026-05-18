"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { setPixelIds } from "@/lib/tracking";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export default function TrackingScripts() {
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
      })
      .catch(() => {});
  }, []);

  // ব্রাউজারে fbq ফাংশনটি আগে থেকেই ডিফাইন করে রাখছি যেন এরর না আসে
  useEffect(() => {
    if (typeof window !== "undefined" && !window.fbq) {
      window.fbq = function() {
        window.fbq.callMethod ? window.fbq.callMethod.apply(window.fbq, arguments) : window.fbq.queue.push(arguments);
      };
      window.fbq.queue = [];
      window.fbq.loaded = true;
      window.fbq.version = "2.0";
    }

    if (typeof window !== "undefined" && !window.ttq) {
      const ttq = window.ttq = [] as any;
      ttq.methods = ["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
      ttq.setAndDefer = function(t: any, e: any){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
      for(let i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
      window.ttq = ttq;
    }
  }, []);

  // টিকটক লোড করার জন্য
  useEffect(() => {
    if (tiktokCode && typeof window !== "undefined" && window.ttq) {
      // টিকটক নিজেই স্ক্রিপ্ট ইনজেক্ট করে
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${tiktokCode}&lib=ttq`;
      document.head.appendChild(script);
      
      window.ttq.page();
      
      if (window.__flushTrackingQueue) {
        window.__flushTrackingQueue();
      }
    }
  }, [tiktokCode]);

  return (
    <>
      {metaId && (
        <Script
          id="meta-pixel-src"
          src="https://connect.facebook.net/en_US/fbevents.js"
          strategy="afterInteractive"
          onLoad={() => {
            // স্ক্রিপ্ট লোড হওয়ার পর ইনিশিয়ালাইজ করো
            window.fbq('init', metaId);
            window.fbq('track', 'PageView');
            
            // কিউ ফ্লাশ করো
            if (window.__flushTrackingQueue) {
              window.__flushTrackingQueue();
            }
          }}
        />
      )}
    </>
  );
}
