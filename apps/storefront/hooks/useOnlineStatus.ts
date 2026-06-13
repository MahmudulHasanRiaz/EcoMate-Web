"use client";

import { useState, useEffect, useRef } from "react";

export default function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined") return;

    // navigator.onLine is unreliable with Service Workers active.
    // When the browser reports offline, verify with an actual API ping
    // before updating state, and debounce to avoid flickering.
    const verifyOnline = async (): Promise<boolean> => {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 5000);
        const res = await fetch("/api/system-settings/storefront", {
          method: "HEAD",
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(id);
        return res.ok;
      } catch {
        return false;
      }
    };

    const handleOffline = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        const actual = await verifyOnline();
        setOnline(actual);
        timerRef.current = null;
      }, 2000);
    };

    const handleOnline = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setOnline(true);
    };

    // Periodically verify connectivity
    const interval = setInterval(async () => {
      if (!navigator.onLine) {
        const actual = await verifyOnline();
        setOnline(actual);
      }
    }, 15000);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return online;
}
