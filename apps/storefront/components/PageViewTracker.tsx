"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const API_URL = typeof window !== "undefined" && !window.location.hostname.includes("localhost")
  ? "/api"
  : process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

function PageViewTrackerInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sidRef = useRef<string>("");
  const sentUrlRef = useRef<string>("");

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
    // Only fire once per distinct URL — prevents double-fire from router transitions
    if (sentUrlRef.current === url) return;
    sentUrlRef.current = url;

    const referrer = document.referrer || "";

    const payload = JSON.stringify({ url, referrer, sessionId: sidRef.current });
    const send = () => {
      // sendBeacon uses text/plain by default — backend must accept it or we set Blob type
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`${API_URL}/tracking/page-view`, new Blob([payload], { type: "application/json" }));
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

export function PageViewTracker() {
  return (
    <Suspense fallback={null}>
      <PageViewTrackerInner />
    </Suspense>
  );
}
