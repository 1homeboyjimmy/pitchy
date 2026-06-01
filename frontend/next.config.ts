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
    // Условие «это API-вызов клиента». Наши fetch из lib/api.ts всегда шлют
    // заголовок `x-pitchy-api: 1`, а навигация в браузере — нет.
    // ПОЧЕМУ не по Authorization: приложение работает на httpOnly cookie-сессиях,
    // getToken() возвращает маркер "cookie-session", а не JWT, поэтому реальные
    // юзеры НЕ шлют `Authorization: Bearer …` вовсе — Bearer-условие не срабатывало
    // и /grants-fetch получал HTML страницы (→ SyntaxError при JSON.parse).
    // Кастомный заголовок надёжен в обоих режимах (cookie и Bearer) и переживает
    // Caddy Basic Auth: браузерная навигация его никогда не шлёт, а fetch — всегда.
    const hasAuth = [{ type: "header" as const, key: "x-pitchy-api" }];
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
