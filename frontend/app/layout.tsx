import type { Metadata } from "next";
import { Providers } from "./providers";
import { DarkVeilWrapper } from "@/components/effects/DarkVeilWrapper";
import "./globals.css";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

export const metadata: Metadata = {
  title: "Pitchy.pro — Анализ стартапов с ИИ",
  description:
    "Оценка стартапов на базе искусственного интеллекта. Получите мгновеннй скоринг, оценку рисков и подробные отчеты для инвесторов.",
  openGraph: {
    title: "Pitchy.pro — Анализ стартапов с ИИ",
    description: "Оценка стартапов на базе искусственного интеллекта. Получите мгновенную аналитику и инвестиционную оценку.",
    url: "https://pitchy.pro",
    siteName: "Pitchy.pro",
    locale: "ru_RU",
    type: "website",
  },
  viewport: {
    width: "device-width",
    initialScale: 1.0,
    maximumScale: 5.0,
    minimumScale: 0.25,
  },
};

import { ScrollToTop } from "@/components/shared/ScrollToTop";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="antialiased">
        <ScrollToTop />
        <Providers>
          <DarkVeilWrapper />
          {children}
        </Providers>
      </body>
    </html>
  );
}
