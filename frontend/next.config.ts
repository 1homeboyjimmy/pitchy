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
    // Условие «есть Bearer-токен в Authorization». Наши клиентские fetch к API
    // всегда шлют `Authorization: Bearer …`, а навигация в браузере — нет.
    // ВАЖНО: на дев-стенде весь сайт за Caddy Basic Auth, и браузер шлёт
    // `Authorization: Basic …` даже при обычной навигации по странице. Поэтому
    // матчим строго `Bearer …`, иначе Basic-навигация на /grants улетала бы на
    // бэкенд-API вместо рендера страницы (→ 500). Это позволяет странице Next и
    // API бэкенда сосуществовать на одном пути (/grants) без коллизии.
    const hasAuth = [{ type: "header" as const, key: "authorization", value: "Bearer .+" }];
    return {
      // beforeFiles выполняется ДО проверки файловых маршрутов (страниц).
      // Гранты: URL /grants и /grants/[id] заняты страницами Next. Поэтому
      // на бэкенд переписываем ТОЛЬКО запросы с заголовком Authorization —
      // это API-вызовы; обычная навигация рендерит страницу грантов.
      beforeFiles: [
        { source: "/grants", has: hasAuth, destination: `${BACKEND_URL}/grants` },
        { source: "/grants/:path*", has: hasAuth, destination: `${BACKEND_URL}/grants/:path*` },
      ],
      afterFiles: [
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
      ],
    };
  },
};

export default nextConfig;
