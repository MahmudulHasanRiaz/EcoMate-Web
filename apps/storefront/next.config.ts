import type { NextConfig } from "next";
import { PHASE_PRODUCTION_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";

const nextConfig: NextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['mac.riaz.com.bd'],
  images: {
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
  },
};

export default async function (phase: string) {
  if (phase === PHASE_PRODUCTION_SERVER || phase === PHASE_PRODUCTION_BUILD) {
    return nextConfig;
  }

  const apiUrl = process.env.API_URL || 'http://localhost:4000';

  return {
    ...nextConfig,
    async headers() {
      return [
        {
          source: '/:path*',
          headers: [
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
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
      return [
        {
          source: '/api/:path*',
          destination: `${apiUrl}/api/:path*`,
        },
        {
          source: '/uploads/:path*',
          destination: `${apiUrl}/uploads/:path*`,
        },
        {
          source: '/assets/:path*',
          destination: `${apiUrl}/assets/:path*`,
        },
        {
          source: '/admin',
          destination: 'http://localhost:5173/admin/',
        },
        {
          source: '/admin/:path*',
          destination: 'http://localhost:5173/admin/:path*',
        },
      ];
    },
  };
}
