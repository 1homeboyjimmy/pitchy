import type { Metadata, Viewport } from "next";
import { Prata, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Self-hosted fonts (next/font downloads & serves them from our own origin —
// no runtime dependency on fonts.googleapis.com, which is unreliable/blocked
// in RU). Cyrillic subset is mandatory: the whole site is Russian.
const prata = Prata({
  subsets: ["latin", "cyrillic"],
  weight: "400",
  variable: "--font-prata",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  style: ["normal", "italic"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
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
import { YandexMetrika, METRIKA_ID } from "@/components/analytics/YandexMetrika";


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
        <YandexMetrika />
        <noscript>
          <div>
            <img src={`https://mc.yandex.ru/watch/${METRIKA_ID}`} style={{ position: "absolute", left: "-9999px" }} alt="" />
          </div>
        </noscript>
        <ScrollToTop />
        <BreadcrumbsSchema />
        {children}
      </body>
    </html>
  );
}
