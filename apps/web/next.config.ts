import type { NextConfig } from 'next';

const serverApiBaseUrl =
  process.env.SERVER_API_BASE_URL?.replace(/\/+$/, '') ||
  'http://localhost:3001/api';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${serverApiBaseUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
