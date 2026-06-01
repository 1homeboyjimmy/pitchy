import type { NextConfig } from "next";

// Internal URL for server-side rewrites (Docker network or local)
const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval'; media-src 'self' blob: https://stream.mux.com https: data:; worker-src 'self' blob:; connect-src 'self' https://stream.mux.com https: wss:;",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      // Proxy all backend API paths through Next.js server
      { source: "/guest/:path*", destination: `${BACKEND_URL}/guest/:path*` },
      { source: "/billing/:path*", destination: `${BACKEND_URL}/billing/:path*` },
      { source: "/auth/:path*", destination: `${BACKEND_URL}/auth/:path*` },
      { source: "/admin/:path*", destination: `${BACKEND_URL}/admin/:path*` },
      { source: "/chat/:path*", destination: `${BACKEND_URL}/chat/:path*` },
      { source: "/me", destination: `${BACKEND_URL}/me` },
      // /me/usage и прочие подпути /me/* (раньше проксировался только точный /me).
      { source: "/me/:path*", destination: `${BACKEND_URL}/me/:path*` },
      { source: "/analyze", destination: `${BACKEND_URL}/analyze` },
      { source: "/analyze/:path*", destination: `${BACKEND_URL}/analyze/:path*` },
      { source: "/health", destination: `${BACKEND_URL}/health` },
      { source: "/dev/:path*", destination: `${BACKEND_URL}/dev/:path*` },
      { source: "/tree/:path*", destination: `${BACKEND_URL}/tree/:path*` },
      { source: "/contact-form", destination: `${BACKEND_URL}/contact-form` },
      // Паспорт проекта. Коллизий со страницами нет — проксируем напрямую.
      { source: "/projects", destination: `${BACKEND_URL}/projects` },
      { source: "/projects/:path*", destination: `${BACKEND_URL}/projects/:path*` },
      // Гранты: страница /grants и /grants/[id] заняли эти URL, поэтому API
      // грантов идёт через /api/grants и переписывается на бэкендовый /grants.
      { source: "/api/grants", destination: `${BACKEND_URL}/grants` },
      { source: "/api/grants/:path*", destination: `${BACKEND_URL}/grants/:path*` },
    ];
  },
};

export default nextConfig;
