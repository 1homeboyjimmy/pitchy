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
