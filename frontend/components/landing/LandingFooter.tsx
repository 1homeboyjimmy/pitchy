"use client";

import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="relative bg-background pt-24 pb-12 overflow-hidden border-t border-foreground/5">
      <div className="max-w-7xl mx-auto px-6 md:px-12 relative z-10 font-body-sm">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-12">
          <div className="space-y-6">
            <h4 className="text-foreground text-sm font-bold uppercase tracking-widest font-display">Product</h4>
            <ul className="space-y-3">
              <li><Link className="text-sm text-foreground/50 hover:text-foreground transition-colors" href="/">Home</Link></li>
              <li><Link className="text-sm text-foreground/50 hover:text-foreground transition-colors" href="/pricing">Pricing</Link></li>
              <li><Link className="text-sm text-foreground/50 hover:text-foreground transition-colors" href="/faq">FAQ</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-foreground text-sm font-bold uppercase tracking-widest font-display">Company</h4>
            <ul className="space-y-3">
              <li><Link className="text-sm text-foreground/50 hover:text-foreground transition-colors" href="/about">About Us</Link></li>
              <li><Link className="text-sm text-foreground/50 hover:text-foreground transition-colors" href="/contact">Contact</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-foreground text-sm font-bold uppercase tracking-widest font-display">Resources</h4>
            <ul className="space-y-3">
              <li><Link className="text-sm text-foreground/50 hover:text-foreground transition-colors" href="/dashboard">Dashboard</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-foreground text-sm font-bold uppercase tracking-widest font-display">Legal</h4>
            <ul className="space-y-3">
              <li><Link className="text-sm text-foreground/50 hover:text-foreground transition-colors" href="/privacy">Privacy</Link></li>
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors" href="/terms">Terms</Link></li>
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors" href="/security">Security</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-24 pt-8 border-t border-foreground/5 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-foreground font-bold text-xl tracking-tighter font-display uppercase">
                PITCHY<span className="text-[#a855f7]">.</span>PRO
            </span>
          </div>
          <p className="text-foreground/30 text-xs font-light">
            © 2024 Pitchy.pro. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
