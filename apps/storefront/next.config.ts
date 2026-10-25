import type { NextConfig } from "next";
import { PHASE_PRODUCTION_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";

const nextConfig: NextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['mac.riaz.com.bd'],
  images: {
    loader: 'custom',
    loaderFile: './lib/image-loader.ts',
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.example.com' },
      { protocol: 'http', hostname: 'localhost', port: '4000' },
      { protocol: 'https', hostname: 'mac.riaz.com.bd' },
      { protocol: 'http', hostname: 'mac.riaz.com.bd' },
      { protocol: 'https', hostname: '**.r2.dev' },
      { protocol: 'https', hostname: '**.amazonaws.com' },
      { protocol: 'https', hostname: '**.cloudfront.net' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 768, 1024, 1280, 1536],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 31536000,
  },
};

export default async function (phase: string) {
  const isProd = phase === PHASE_PRODUCTION_SERVER || phase === PHASE_PRODUCTION_BUILD;
  const apiUrl = process.env.API_URL || (isProd ? 'http://backend:4000' : 'http://localhost:4000');
  // API_URL may be given with or without the /api suffix (the compose default
  // includes it). The rewrites below always append their own prefix, so
  // normalize to the backend origin — otherwise /api/* resolves to
  // /api/api/* and every proxied browser API call 404s.
  const apiOrigin = apiUrl.replace(/\/api\/?$/, '');
  const posUrl = process.env.POS_URL || (isProd ? 'http://pos:80' : 'http://localhost:5174');

  return {
    ...nextConfig,
    async headers() {
      // Short shared-cache TTL for anonymous public pages (spike absorber).
      // Browsers ignore s-maxage; a CDN (Cloudflare, 5.2) serves HITs from it.
      // Private routes (/checkout, /cart, /orders, /wishlist, /account, /api,
      // /landing) intentionally get NO Cache-Control — never cache those.
      const edgeCache = [{ key: 'Cache-Control', value: 'public, s-maxage=60, stale-while-revalidate=300' }];
      return [
        {
          source: '/',
          headers: edgeCache,
        },
        {
          source: '/products/:path*',
          headers: edgeCache,
        },
        {
          source: '/category/:path*',
          headers: edgeCache,
        },
        {
          source: '/brand/:path*',
          headers: edgeCache,
        },
        {
          source: '/combos/:path*',
          headers: edgeCache,
        },
        {
          source: '/:path*',
          headers: [
            // SECURITY (2026-10-25, F22): report-only CSP for the main
            // storefront. Deliberately permissive where the app needs it
            // (inline scripts/styles exist throughout: TrackingScripts,
            // JSON-LD, CustomRenderer) and strict where it costs nothing
            // (object-src 'none', base-uri 'self'). Enforcing a strict
            // policy today would break tracking embeds and inline UI, so
            // this only REPORTS — violations land in /api/csp-report and
            // are the evidence for a future enforcing policy. Landing
            // pages are excluded from this round (Q5 decision pending:
            // their raw-HTML feature needs its own policy).
            { key: 'Content-Security-Policy-Report-Only', value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://connect.facebook.net https://www.googletagmanager.com https://analytics.tiktok.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https:; frame-src https://www.facebook.com https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; report-uri /api/csp-report" },
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), nfc=(), cross-origin-isolated=(), display-capture=(), fullscreen=(), keyboard-map=(), screen-wake-lock=(), sync-xhr=(), web-share=()' },
            { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
            { key: 'X-DNS-Prefetch-Control', value: 'on' },
          ],
        },
      ];
    },
    async redirects() {
      return [
        {
          source: '/favicon.ico',
          destination: '/favicon.svg',
          permanent: true,
        },
      ];
    },
    async rewrites() {
      const list = [
        {
          source: '/orders/:id',
          destination: '/orders?id=:id',
        },
        {
          source: '/api/:path*',
          destination: `${apiOrigin}/api/:path*`,
        },
        {
          source: '/uploads/:path*',
          destination: `${apiOrigin}/uploads/:path*`,
        },
        {
          source: '/assets/:path*',
          destination: `${apiOrigin}/assets/:path*`,
        },
        {
          source: '/pos',
          destination: `${posUrl}/pos/`,
        },
        {
          source: '/pos/:path*',
          destination: `${posUrl}/pos/:path*`,
        },
      ];
      if (!isProd) {
        list.push(
          {
            source: '/admin',
            destination: 'http://localhost:5173/admin/',
          },
          {
            source: '/admin/:path*',
            destination: 'http://localhost:5173/admin/:path*',
          }
        );
      }
      return list;
    },
  };
}
