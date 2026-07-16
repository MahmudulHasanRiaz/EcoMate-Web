"use client";

import { useState, useEffect, useCallback } from 'react';
import { Download, X } from 'lucide-react';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PWAInstallBanner() {
  const { config } = useStorefrontConfig();
  const storeName = config.store.name || 'Store';
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      const prompt = e as BeforeInstallPromptEvent;
      setDeferredPrompt(prompt);
      if (!dismissed) {
        setShowBanner(true);
      }
    };

    if (window.__deferredPWAInstall) {
      setDeferredPrompt(window.__deferredPWAInstall as BeforeInstallPromptEvent);
      if (!dismissed) setShowBanner(true);
    }

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [dismissed]);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShowBanner(false);
    if (outcome === 'accepted') {
      localStorage.setItem('pwa-installed', '1');
    }
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setShowBanner(false);
    setDismissed(true);
    sessionStorage.setItem('pwa-banner-dismissed', '1');
  }, []);

  useEffect(() => {
    const alreadyInstalled = localStorage.getItem('pwa-installed');
    const alreadyDismissed = sessionStorage.getItem('pwa-banner-dismissed');
    if (alreadyInstalled || alreadyDismissed) {
      setShowBanner(false);
    }
  }, []);

  if (!showBanner || !deferredPrompt) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-[9999] md:left-auto md:right-6 md:bottom-6 md:max-w-sm">
      <div className="bg-white rounded-2xl shadow-[0_8px_40px_rgb(0,0,0,0.15)] border border-gray-100 p-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-brand-blue/10 text-brand-blue rounded-xl flex items-center justify-center flex-shrink-0">
          <Download size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">Install {storeName}</p>
          <p className="text-xs text-gray-500">Add to home screen for faster access</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleInstall}
            className="bg-brand-blue text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-brand-blue-dark transition-colors"
          >
            Install
          </button>
          <button
            onClick={handleDismiss}
            className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
