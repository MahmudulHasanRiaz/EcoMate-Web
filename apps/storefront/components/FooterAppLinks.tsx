"use client";

// P5 (JS diet): the only part of the Footer that needs the browser — the
// platform-specific app-download links. Extracted verbatim from the old
// client Footer so the rest of the Footer can be a Server Component.
//
// The platform must NOT be resolved during render (see the hydration bug
// history on this code): it stays null through the first render and is
// resolved in an effect, so server and first client render are identical.

import React, { useEffect, useState } from "react";

type Platform = "android" | "ios" | "other" | null;

function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>(null);

  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    if (ua.includes("android")) setPlatform("android");
    else if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod"))
      setPlatform("ios");
    else setPlatform("other");
  }, []);

  return platform;
}

export default function FooterAppLinks({
  playStoreUrl,
  appStoreUrl,
}: {
  playStoreUrl: string;
  appStoreUrl: string;
}) {
  const platform = usePlatform();
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "";

  return (
    <div className="pt-10 border-t border-gray-100 mb-10">
      <p className="font-bold text-[13px] text-gray-800 mb-4">Download App on Mobile :</p>
      <div className="flex flex-wrap items-center gap-3">
        {playStoreUrl ? (
          <a href={playStoreUrl} target="_blank" rel="noreferrer"
            className="bg-[#1a1a1a] p-1.5 px-3 rounded-md flex items-center gap-2 text-white border border-gray-800 hover:bg-black transition-colors">
            <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor">
              <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z"/>
            </svg>
            <div className="text-left">
              <p className="text-[10px] leading-none text-gray-400">Download on</p>
              <p className="text-[14px] font-bold leading-tight">Google Play</p>
            </div>
          </a>
        ) : platform === 'android' ? (
          <a href={`${apiBase}/mobile-download/storefront/android`}
            className="bg-[#1a1a1a] p-1.5 px-3 rounded-md flex items-center gap-2 text-white border border-gray-800 hover:bg-black transition-colors">
            <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor">
              <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z"/>
            </svg>
            <div className="text-left">
              <p className="text-[10px] leading-none text-gray-400">Get it on</p>
              <p className="text-[14px] font-bold leading-tight">Google Play</p>
            </div>
          </a>
        ) : (<></>)}
        {appStoreUrl ? (
          <a href={appStoreUrl} target="_blank" rel="noreferrer"
            className="bg-[#1a1a1a] p-1.5 px-3 rounded-md flex items-center gap-2 text-white border border-gray-800 hover:bg-black transition-colors">
            <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor">
              <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-111.3-59.9-121.2z"/>
            </svg>
            <div className="text-left">
              <p className="text-[10px] leading-none text-gray-400">Download on</p>
              <p className="text-[14px] font-bold leading-tight">App Store</p>
            </div>
          </a>
        ) : platform === 'ios' ? (
          <a href={`${apiBase}/mobile-download/storefront/ios`}
            className="bg-[#1a1a1a] p-1.5 px-3 rounded-md flex items-center gap-2 text-white border border-gray-800 hover:bg-black transition-colors">
            <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor">
              <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-111.3-59.9-121.2z"/>
            </svg>
            <div className="text-left">
              <p className="text-[10px] leading-none text-gray-400">Get it on</p>
              <p className="text-[14px] font-bold leading-tight">App Store</p>
            </div>
          </a>
        ) : (<></>)}
        {/* Shown until the platform is known, and on desktop where neither
            store applies — one identical branch on both sides of hydration. */}
        {(platform === 'other' || platform === null) && (
          <span className="text-[11px] text-gray-400">
            Open on your phone to install the app
          </span>
        )}
      </div>
    </div>
  );
}
