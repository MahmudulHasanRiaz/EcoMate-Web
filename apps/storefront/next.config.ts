import type { NextConfig } from "next";
import { PHASE_PRODUCTION_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";

const nextConfig: NextConfig = {
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
