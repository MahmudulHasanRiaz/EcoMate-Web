import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['mac.riaz.com.bd'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'placehold.co' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'cdn.example.com' },
      { protocol: 'http', hostname: 'localhost', port: '4000' },
      { protocol: 'https', hostname: 'mac.riaz.com.bd' },
      { protocol: 'http', hostname: 'mac.riaz.com.bd' },
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
