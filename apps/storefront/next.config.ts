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
      // Short shared-cache TTLs for anonymous public pages (spike absorber).
      // Browsers ignore s-maxage; a CDN (Cloudflare, 5.2) serves HITs from it.
      //
      // Per-route TTLs (Speed Plan P4): home is the most volatile public
      // page; archive/listing pages change slower; a PDP changes slowest.
      const homeCache = [{ key: 'Cache-Control', value: 'public, s-maxage=60, stale-while-revalidate=300' }];
      const listingCache = [{ key: 'Cache-Control', value: 'public, s-maxage=120, stale-while-revalidate=600' }];
      const pdpCache = [{ key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=900' }];
      // Private routes must NEVER be shared-cached. This is not optional
      // decoration: a route with no explicit Cache-Control of its own does
      // NOT stay uncached — Next.js derives one from the route's revalidate
      // behaviour. /cart, /checkout, /account, /wishlist and /orders are
      // client-rendered shells whose only server fetch is the root layout's
      // storefront-config fetch (`next: { revalidate: 60 }`); the lowest
      // fetch revalidate in the layout chain sets the whole route's
      // revalidation frequency, so Next served these private shells as ISR
      // with `s-maxage=60, stale-while-revalidate=31535940` (1 year − 60s —
      // Next's default ISR expire window), and the CDN in front then
      // presented them as `public`. An explicit `private, no-store` here is
      // the guaranteed override: headers() values replace Next's own
      // per-route Cache-Control (the same mechanism that already lets the
      // public rules below override the dynamic home/PLP routes), and the
      // private rules are listed LAST so they also win over every other
      // matching rule in this array (Next applies the last matching key).
      const privateCache = [{ key: 'Cache-Control', value: 'private, no-store' }];
      return [
        {
          source: '/',
          headers: homeCache,
        },
        {
          source: '/products/:path*',
          headers: listingCache,
        },
        {
          // PDP is a single segment under /products. Listed AFTER the
          // broader listing rule so it wins for /products/<slug> (last
          // matching Cache-Control key wins); multi-segment paths such as
          // /products/tags/<slug> keep the listing TTL.
          source: '/products/:slug',
          headers: pdpCache,
        },
        {
          source: '/category/:path*',
          headers: listingCache,
        },
        {
          source: '/brand/:path*',
          headers: listingCache,
        },
        {
          source: '/combos/:path*',
          headers: listingCache,
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
        // Private route groups — LAST on purpose (see privateCache above):
        // these override Next's derived ISR Cache-Control for the
        // client-rendered private shells and any earlier matching rule.
        // `:path*` also matches the bare prefix (e.g. `/cart` itself).
        // `/api/:path*` mirrors the backend's own policy (its
        // NoStoreMiddleware marks every API response no-store).
        {
          source: '/cart/:path*',
          headers: privateCache,
        },
        {
          source: '/checkout/:path*',
          headers: privateCache,
        },
        {
          source: '/account/:path*',
          headers: privateCache,
        },
        {
          source: '/wishlist/:path*',
          headers: privateCache,
        },
        {
          source: '/orders/:path*',
          headers: privateCache,
        },
        {
          source: '/api/:path*',
          headers: privateCache,
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
