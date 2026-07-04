"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sidRef = useRef<string>("");

  useEffect(() => {
    if (!sidRef.current) {
      let sid = localStorage.getItem("pv_sid");
      if (!sid) {
        sid = crypto.randomUUID();
        localStorage.setItem("pv_sid", sid);
      }
      sidRef.current = sid;
    }

    const url = window.location.href;
    const referrer = document.referrer || "";

    const send = () => {
      const payload = JSON.stringify({ url, referrer, sessionId: sidRef.current });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`${API_URL}/tracking/page-view`, payload);
      } else {
        fetch(`${API_URL}/tracking/page-view`, {
          method: "POST", body: payload, keepalive: true,
          headers: { "Content-Type": "application/json" },
        }).catch(() => {});
      }
    };

    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(send, { timeout: 2000 });
    } else {
      setTimeout(send, 0);
    }
  }, [pathname, searchParams]);

  return null;
}
