import type { Metadata } from "next";
import { Providers } from "./providers";
import { DarkVeilWrapper } from "@/components/effects/DarkVeilWrapper";
import "./globals.css";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

export const metadata: Metadata = {
  title: "Pitchy.pro — AI Startup Analysis",
  description:
    "AI-powered startup evaluation. Get instant investment scores, risk assessment, and intelligence reports.",
  viewport: {
    width: "device-width",
    initialScale: 1.0,
    maximumScale: 5.0,
    minimumScale: 0.25,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          <DarkVeilWrapper />
          {children}
        </Providers>
      </body>
    </html>
  );
}
