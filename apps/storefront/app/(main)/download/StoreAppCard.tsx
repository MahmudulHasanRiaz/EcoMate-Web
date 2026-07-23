"use client";

import { Download } from 'lucide-react';

function getPlatform(): 'android' | 'ios' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios';
  return 'other';
}

export function StoreAppCard({
  name,
  description,
  icon: Icon,
  badge,
  playStoreUrl,
  appStoreUrl,
}: {
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge: string;
  playStoreUrl?: string;
  appStoreUrl?: string;
}) {
  const platform = getPlatform();

  const andLink = playStoreUrl || (platform === 'android' ? '/' : null);
  const iosLink = appStoreUrl || (platform === 'ios' ? '/' : null);
  const otherLink = !playStoreUrl && !appStoreUrl && platform === 'other' ? '/' : null;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 bg-brand-blue/10 text-brand-blue rounded-2xl flex items-center justify-center flex-shrink-0">
          <Icon size={28} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-bold text-gray-900 text-lg">{name}</h3>
            <span className="text-[10px] font-bold text-brand-blue bg-brand-blue/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
              {badge}
            </span>
          </div>
          <p className="text-gray-500 text-sm mb-4">{description}</p>
          <div className="flex flex-wrap gap-2">
            {andLink ? (
              <a href={andLink} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 bg-[#1a1a1a] text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-black transition-colors">
                <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
                  <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z"/>
                </svg>
                Google Play
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-500 text-xs font-bold px-4 py-2.5 rounded-xl">
                <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
                  <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z"/>
                </svg>
                Android
              </span>
            )}
            {iosLink ? (
              <a href={iosLink} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 bg-[#1a1a1a] text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-black transition-colors">
                <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
                  <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-111.3-59.9-121.2z"/>
                </svg>
                App Store
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-500 text-xs font-bold px-4 py-2.5 rounded-xl">
                <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
                  <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-111.3-59.9-121.2z"/>
                </svg>
                iOS
              </span>
            )}
          </div>
          {!playStoreUrl && !appStoreUrl && platform === 'other' && (
            <p className="text-[11px] text-gray-400 mt-2">Open this page on your phone to download the app</p>
          )}
        </div>
      </div>
    </div>
  );
}
