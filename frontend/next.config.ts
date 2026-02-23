import type { NextConfig } from "next";

// Internal URL for server-side rewrites (Docker network)
const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || "http://backend:8000";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    return [
      // Proxy all backend API paths through Next.js server
      { source: "/billing/:path*", destination: `${BACKEND_URL}/billing/:path*` },
      { source: "/auth/:path*", destination: `${BACKEND_URL}/auth/:path*` },
      { source: "/admin/:path*", destination: `${BACKEND_URL}/admin/:path*` },
      { source: "/chat/:path*", destination: `${BACKEND_URL}/chat/:path*` },
      { source: "/me", destination: `${BACKEND_URL}/me` },
      { source: "/analyze", destination: `${BACKEND_URL}/analyze` },
      { source: "/analyze/:path*", destination: `${BACKEND_URL}/analyze/:path*` },
      { source: "/health", destination: `${BACKEND_URL}/health` },
      { source: "/dev/:path*", destination: `${BACKEND_URL}/dev/:path*` },
    ];
  },
};

export default nextConfig;
