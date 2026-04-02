import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "./globals.css";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

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
import { LightRaysWrapper } from "@/components/effects/LightRaysWrapper";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="antialiased">
        <ScrollToTop />
        <BreadcrumbsSchema />
        <Providers>
          <LightRaysWrapper />
          {children}
        </Providers>
      </body>
    </html>
  );
}
