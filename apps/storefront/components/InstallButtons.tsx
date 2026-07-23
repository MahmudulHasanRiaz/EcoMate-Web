"use client";

import { useState, useEffect, useCallback } from 'react';
import { Download } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function getPlatform(): 'android' | 'ios' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios';
  return 'other';
}

export default function InstallButtons({
  playStoreUrl,
  appStoreUrl,
}: {
  playStoreUrl?: string;
  appStoreUrl?: string;
}) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const platform = getPlatform();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    if (window.__deferredPWAInstall) {
      setDeferredPrompt(window.__deferredPWAInstall as BeforeInstallPromptEvent);
    }

    window.addEventListener('beforeinstallprompt', handler);
    const installedFlag = localStorage.getItem('pwa-installed');
    if (installedFlag) setInstalled(true);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === 'accepted') {
      setInstalled(true);
      localStorage.setItem('pwa-installed', '1');
    }
  }, [deferredPrompt]);

  if (installed) {
    return (
      <span className="text-[11px] text-green-600 font-medium">
        App installed
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Android — Play Store link or PWA prompt */}
      {platform === 'android' && (
        playStoreUrl ? (
          <a
            href={playStoreUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 bg-brand-blue text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-brand-blue-dark transition-colors"
          >
            <Download size={14} />
            Get it on Google Play
          </a>
        ) : (
          <>
            <button
              onClick={handleInstall}
              disabled={!deferredPrompt}
              className="inline-flex items-center gap-1.5 bg-brand-blue text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-brand-blue-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={14} />
              {deferredPrompt ? 'Install App' : 'Add to Home Screen'}
            </button>
            <span className="text-[11px] text-gray-400">
              or browser menu → Add to Home Screen
            </span>
          </>
        )
      )}

      {/* iOS — App Store link or Safari instructions */}
      {platform === 'ios' && (
        appStoreUrl ? (
          <a
            href={appStoreUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 bg-brand-blue text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-brand-blue-dark transition-colors"
          >
            <Download size={14} />
            Download on the App Store
          </a>
        ) : (
          <span className="text-xs text-gray-500">
            Open Safari → Share → Add to Home Screen
          </span>
        )
      )}

      {/* Desktop — generic guidance */}
      {platform === 'other' && (
        <span className="text-[11px] text-gray-400">
          Open on your phone to install the app
        </span>
      )}
    </div>
  );
}
