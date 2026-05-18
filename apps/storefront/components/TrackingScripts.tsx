"use client";

import { useEffect, useState } from "react";
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
    if (metaId || tiktokCode) {
      // যদি অলরেডি স্ক্রিপ্টটি লোড হয়ে থাকে, তবে আর লোড করো না
      if (document.getElementById("tracking-script")) return;

      // গ্লোবাল ভেরিয়েবলে আইডিগুলো রাখছি যেন এক্সটার্নাল ফাইলটি রিড করতে পারে
      (window as any).__META_ID = metaId;
      (window as any).__TIKTOK_CODE = tiktokCode;

      // এক্সটার্নাল স্ক্রিপ্ট লোড করো
      const script = document.createElement("script");
      script.id = "tracking-script";
      script.src = "/scripts/tracking.js";
      script.async = true;
      document.head.appendChild(script);

      return () => {
        script.remove();
      };
    }
  }, [metaId, tiktokCode]);

  return null;
}
