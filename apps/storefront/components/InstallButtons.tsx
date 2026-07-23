"use client";

import { useState, useEffect, useCallback } from 'react';
import { Download, Smartphone } from 'lucide-react';

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

export default function InstallButtons() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [supported, setSupported] = useState(true);
  const platform = getPlatform();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    if (window.__deferredPWAInstall) {
      setDeferredPrompt(window.__deferredPWAInstall as BeforeInstallPromptEvent);
    } else if (!('BeforeInstallPromptEvent' in window)) {
      // beforeinstallprompt not supported — PWA install still possible manually
      setSupported(false);
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
      {/* Android: show Install button (triggers PWA prompt in browser) */}
      {platform === 'android' && (
        <button
          onClick={handleInstall}
          disabled={!deferredPrompt}
          className="inline-flex items-center gap-1.5 bg-brand-blue text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-brand-blue-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={14} />
          {deferredPrompt ? 'Install App' : 'Add to Home Screen'}
        </button>
      )}

      {/* iOS: show instructions (no programmatic install on iOS) */}
      {platform === 'ios' && (
        <span className="text-xs text-gray-500">
          Open Safari → Share → Add to Home Screen
        </span>
      )}

      {/* Desktop / unknown: show generic install option */}
      {platform === 'other' && (
        <span className="text-[11px] text-gray-400">
          Open on your phone to install the app
        </span>
      )}

      {/* Platform-agnostic fallback: always visible */}
      {platform !== 'ios' && (
        <span className="text-[11px] text-gray-400">
          or browser menu → Add to Home Screen
        </span>
      )}
    </div>
  );
}
