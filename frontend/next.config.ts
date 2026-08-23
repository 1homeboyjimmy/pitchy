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
            // script-src без wildcard https: — иначе инъектированный
            // <script src="https://evil/x.js"> прошёл бы. 'unsafe-inline'/eval
            // пока оставлены (Next инлайнит бутстрап без nonce); следующий шаг —
            // nonce через middleware. HTTPS для картинок и соединений остаётся
            // широким из-за внешних источников грантов и API.
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://mc.yandex.ru",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "media-src 'self' blob: https://stream.mux.com data:",
              "worker-src 'self' blob:",
              "connect-src 'self' https://stream.mux.com https: wss:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "object-src 'none'",
              "form-action 'self' https://*.yandex.ru https://accounts.google.com https://github.com https://yoomoney.ru https://yookassa.ru",
            ].join("; "),
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
      // на бэкенд переписываем ТОЛЬКО запросы с заголовком x-pitchy-api —
      // это API-вызовы; обычная навигация рендерит страницу грантов.
      beforeFiles: [
        // Same-origin URL keeps the browser on Pitchy while Next proxies the
        // existing hero asset. The optimized poster remains the LCP element.
        {
          source: "/media/hero.mp4",
          destination: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_115001_bcdaa3b4-03de-47e7-ad63-ae3e392c32d4.mp4",
        },
        { source: "/grants", has: hasAuth, destination: `${BACKEND_URL}/grants` },
        { source: "/grants/:path*", has: hasAuth, destination: `${BACKEND_URL}/grants/:path*` },
      ],
      afterFiles: [
        // Proxy all backend API paths through Next.js server
        { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
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
        { source: "/public/:path*", destination: `${BACKEND_URL}/public/:path*` },
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
