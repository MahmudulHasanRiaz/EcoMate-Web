import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['mac.riaz.com.bd'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'placehold.co' },
      { protocol: 'http', hostname: 'localhost', port: '4000' },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:4000/api/:path*',
      },
      {
        source: '/uploads/:path*',
        destination: 'http://localhost:4000/uploads/:path*',
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

export default nextConfig;
