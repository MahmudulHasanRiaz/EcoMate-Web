"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { useAuth } from "@/context/AuthContext";
import { setPixelIds, setPixelIdentity, setTrackingConfig, setConsent, setTrackingConsent, isTrackingAllowed } from "@/lib/tracking";
import { getTrackingApiUrl, syncContext } from "@/lib/tracking-client";
import { captureLandingAttribution } from "@/lib/attribution";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

export default function TrackingScripts() {
  const { config } = useStorefrontConfig();
  const { user } = useAuth();
  const metaId = config.meta.pixelEnabled ? config.meta.pixelId : "";
  const tiktokCode = config.tiktok.pixelEnabled ? config.tiktok.pixelCode : "";
  const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || '';
  const gaAdsConversionId = process.env.NEXT_PUBLIC_GA_ADS_CONVERSION_ID || '';
  const hasAny = !!(metaId || tiktokCode || gaMeasurementId);
  // Wave-2.1 — shopper external_id resolution state; gates the Meta pixel init
  // so the external_id is present at fbq('init') (no re-init, no next-load dep).
  // Wave-3 — fbLoginId rides along (CAPI mirror key, never in the pixel init).
  const [identity, setIdentity] = useState<{ ready: boolean; externalId: string | null; em?: string; ph?: string; fbLoginId?: string | null }>({
    ready: false,
    externalId: null,
    fbLoginId: null,
  });
  // Wave-2.3 — whether /tracking/config has been resolved; all scripts stay
  // suppressed until we know tracking is allowed.
  const [consentChecked, setConsentChecked] = useState(false);
  // Bumped by window.__ecomateSetConsent so a later grant/revoke re-renders and
  // (un)mounts the scripts against the fresh module consent state.
  const [consentVersion, setConsentVersion] = useState(0);

  // Wave-2.3 — resolve consent config on mount. Not required → default granted
  // (allowed). Required → grant only counts when localStorage says 'granted'.
  // On failure degrade to the safe default (not required → allowed).
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    fetch(`${getTrackingApiUrl()}/tracking/config`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d: { consentRequired?: boolean; advancedMatching?: boolean; externalIdEnabled?: boolean }) => {
        if (cancelled) return;
        const required = !!d.consentRequired;
        let granted = true;
        if (required) {
          let stored: string | null = null;
          try {
            stored = localStorage.getItem('ecomate_tracking_consent');
          } catch {
            /* storage unavailable — treat as not granted */
          }
          granted = stored === 'granted';
        }
        setConsent(required, granted);
        setConsentChecked(true);
      })
      .catch(() => {
        // timeout / network / abort → no consent requirement, tracking allowed (safe default).
        if (!cancelled) {
          setConsent(false, true);
          setConsentChecked(true);
        }
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  // Wave-2.3 — expose a global so a future consent banner can drive tracking state.
  useEffect(() => {
    (window as any).__ecomateSetConsent = (granted: boolean) => {
      setTrackingConsent(granted);
      setConsentVersion((v) => v + 1);
    };
    return () => {
      delete (window as any).__ecomateSetConsent;
    };
  }, []);

  useEffect(() => {
    setPixelIds(metaId, tiktokCode);
    // Capture the session landing attribution on first app boot (first write
    // wins) so the landing page's utm/click-id/referrer survive to checkout.
    captureLandingAttribution();
    setTrackingConfig(config.meta.purchaseMode || 'instant', config.tiktok.purchaseMode || 'instant');
    syncContext(); // begin tracking-context capture on mount (ctxId + identifiers + url + referrer)
    // P1 fix: re-sync shortly after load so _fbp/_fbc created by fbevents.js
    // (lazyOnload) reach the context row — the mount-time sync races the pixel
    // script and would otherwise miss the cookies (empty fbp/fbc coverage).
    const resync = setTimeout(() => {
      syncContext();
    }, 3000);
    return () => clearTimeout(resync);
  }, [metaId, tiktokCode, config.meta.purchaseMode, config.tiktok.purchaseMode]);

  // Wave-2.1 — resolve the shopper's stable external_id for the Pixel. Endpoint
  // returns null when the flag is off or there is no linked CustomerProfile, so
  // the call is always safe. Guests resolve immediately to null.
  useEffect(() => {
    if (!user) {
      setIdentity({ ready: true, externalId: null });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    fetch(`${getTrackingApiUrl()}/tracking/identity`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d: { externalId?: string | null; em?: string; ph?: string; fbLoginId?: string | null }) => {
        if (!cancelled) setIdentity({ ready: true, externalId: d.externalId ?? null, em: d.em, ph: d.ph, fbLoginId: d.fbLoginId ?? null });
      })
      .catch(() => {
        // timeout / network / abort → degrade to no external_id; the Meta init
        // must NOT be blocked by a hung identity lookup (B5).
        if (!cancelled) setIdentity({ ready: true, externalId: null });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [user]);

  // Wave-2.1 — once the pixel id and identity are both known, arm the data-driven
  // Meta init. Meta events buffer in initMetaPixel until this runs (init-first).
  useEffect(() => {
    if (!metaId || !identity.ready) return;
    setPixelIdentity(identity.externalId, identity.em, identity.ph, identity.fbLoginId);
    (window as any).__TRACKING_INIT_READY = true;
    if (window.__initMetaPixel) window.__initMetaPixel();
  }, [metaId, identity.ready, identity.externalId, identity.em, identity.ph, identity.fbLoginId]);

  // B12: the orphaned public/scripts/tracking.js (deleted) is the only consumer
  // of __META_ID/__TIKTOK_CODE — dropped to close the latent double-fire hazard.

  if (!hasAny) return null;
  // Wave-2.3 — consent/opt-out: until /tracking/config resolves (or on revoke /
  // opt-out) suppress ALL tracking tags; nothing must load for a non-consenting
  // shopper. `consentVersion` re-evaluates this on later global consent flips.
  if (!consentChecked || !isTrackingAllowed()) return null;

  return (
    <>
      <Script id="app-tracking-init" strategy="lazyOnload"
        dangerouslySetInnerHTML={{
          __html: `
          (function() {
            const metaId = ${JSON.stringify(metaId)};
            const tiktokCode = ${JSON.stringify(tiktokCode)};
            const gaId = ${JSON.stringify(gaMeasurementId)};

            // মেটা পিক্সেল
            if (metaId && !window.fbq) {
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              // Wave-2.1 — Meta init is data-driven (initMetaPixel), deferred until
              // identity is resolved so the external_id is present at init.
            }

            // টিকটক পিক্সেল
            if (tiktokCode && !window.ttq) {
              !function(w,d,t){
                w.TiktokAnalyticsObject=t;
                var ttq=w[t]=w[t]||[];
                ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
                ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
                for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
                ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
                ttq.load=function(e,n){
                  var i="https://analytics.tiktok.com/i18n/pixel/events.js";
                  var o=n&&n.partner;ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;
                  var r=document.createElement("script");r.type="text/javascript";r.async=true;r.src=i+"?sdkid="+e+"&lib="+t;
                  var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(r,a);
                };
              }(window,document,'ttq');
              
              ttq.load(tiktokCode);
              ttq.page();
            }

            // Google gtag.js (GA4 + Google Ads)
            if (gaId && !window.gtag) {
              window.dataLayer = window.dataLayer || [];
              window.gtag = function(){window.dataLayer.push(arguments);};
              window.gtag('js', new Date());
              window.gtag('config', gaId, { send_page_view: true });
              ${gaAdsConversionId ? `window.gtag('config', ${JSON.stringify(gaAdsConversionId)});` : ''}

              var s = document.createElement('script');
              s.async = true;
              s.src = 'https://www.googletagmanager.com/gtag/js?id=' + gaId;
              var a = document.getElementsByTagName('script')[0];
              a.parentNode.insertBefore(s, a);
            }

            // Wave-2.1 — data-driven Meta init (external_id resolved by TrackingScripts)
            if (window.__TRACKING_INIT_READY && window.__initMetaPixel) {
              window.__initMetaPixel();
            }
            // আমাদের তৈরি কিউ ফ্লাশ করো
            if (window.__flushTrackingQueue) {
              window.__flushTrackingQueue();
            }
          })();
        `}}
      />
    </>
  );
}
