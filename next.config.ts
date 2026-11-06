import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Server-only packages must never be bundled into client components.
  serverExternalPackages: ['mongoose', 'mongodb'],

  experimental: {
    // Server Actions receive the kiosk's transaction payloads.
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  async headers() {
    return [
      {
        // Kiosk endpoints are rendered per request and must never be cached
        // by an intermediary: they display live locker + payment state.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
