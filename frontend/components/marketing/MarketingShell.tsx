"use client";

import { ReactNode } from "react";
import { PlasmaBackground } from "./reactbits/PlasmaBackground";
import { Header } from "../layout/Header";

interface MarketingShellProps {
  children: ReactNode;
}

export function MarketingShell({ children }: MarketingShellProps) {
  return (
    <div className="min-h-screen bg-black text-white relative overflow-x-hidden">
      <PlasmaBackground />
      <Header />
      <main className="relative z-10 pt-20">{children}</main>
    </div>
  );
}

