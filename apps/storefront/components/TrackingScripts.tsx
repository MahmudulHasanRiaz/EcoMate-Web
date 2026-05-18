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

  useEffect(() => {
    if (metaId) (window as any).__META_ID = metaId;
    if (tiktokCode) (window as any).__TIKTOK_CODE = tiktokCode;
  }, [metaId, tiktokCode]);

  // যদি কোনো আইডি না থাকে, তবে কিছুই রেন্ডার করব না
  if (!metaId && !tiktokCode) return null;

  return (
    <>
      <Script
        id="app-tracking-script"
        src="/scripts/tracking.js"
        strategy="afterInteractive"
      />
    </>
  );
}
