import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
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
