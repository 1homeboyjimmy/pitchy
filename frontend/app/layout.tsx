import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import localFont from "next/font/local";
import "./globals.css";

// Keep production builds independent of Google Fonts network availability.
const prata = localFont({
  src: "./fonts/Prata-Regular.ttf",
  variable: "--font-prata",
  display: "swap",
});

const inter = localFont({
  src: [
    { path: "./fonts/Inter-Regular.otf", weight: "400", style: "normal" },
    { path: "./fonts/Inter-SemiBold.otf", weight: "600", style: "normal" },
    { path: "./fonts/Inter-Bold.otf", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-Regular.ttf",
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://pitchy.pro"),
  title: {
    default: "Pitchy.pro — Анализ стартапов с ИИ",
    template: "%s | Pitchy",
  },
  description:
    "Оценка стартапов на базе искусственного интеллекта. Получите мгновенную аналитику, оценку рисков и подробные отчеты для инвесторов.",
  openGraph: {
    url: "https://pitchy.pro",
    siteName: "Pitchy.pro",
    locale: "ru_RU",
    type: "website",
    images: [
      {
        url: "https://pitchy.pro/og-image.png",
        width: 1200,
        height: 630,
        alt: "Pitchy.pro Preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["https://pitchy.pro/og-image.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1.0,
  maximumScale: 5.0,
  minimumScale: 0.25,
};

import { ScrollToTop } from "@/components/shared/ScrollToTop";
import { BreadcrumbsSchema } from "@/components/shared/BreadcrumbsSchema";
import { YandexMetrika } from "@/components/analytics/YandexMetrika";
import { CookieConsentBanner } from "@/components/shared/CookieConsentBanner";


export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ru"
      className={`${prata.variable} ${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* CSP is set by Caddy at the edge — keeping a separate meta tag
            here would mean the browser intersects two different policies
            and the more restrictive wins, making it easy to ship a broken
            page by changing only one place. Single source of truth =
            Caddyfile. */}
      </head>
      <body className="antialiased">
        <Suspense fallback={null}>
          <YandexMetrika />
        </Suspense>
        <ScrollToTop />
        <BreadcrumbsSchema />
        {children}
        <CookieConsentBanner />
      </body>
    </html>
  );
}
