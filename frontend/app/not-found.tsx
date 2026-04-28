"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function NotFound() {
  const [timestamp, setTimestamp] = useState("");

  useEffect(() => {
    setTimestamp(new Date().toISOString());
  }, []);

  return (
    <div className="min-h-screen flex flex-col font-body-sm text-body-sm antialiased">
      <main className="flex-grow flex items-center justify-center p-md">
        <div className="max-w-3xl w-full flex flex-col items-center text-center space-y-xl">
          {/* 404 Title */}
          <div className="space-y-sm w-full">
            <h1 className="font-display text-[120px] leading-none tracking-tighter text-white select-none">404</h1>
            <div className="w-full max-w-[280px] mx-auto border-t border-white/[0.08]"></div>
            <p className="font-code text-code text-neutral-400 uppercase tracking-widest">
              ENDPOINT NOT FOUND
            </p>
          </div>

          {/* System Diagnostic Card */}
          <div className="bg-[#111111] hairline-border p-md w-full max-w-[520px] text-left">
            <div className="flex items-center gap-2 mb-sm pb-sm" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <circle cx="8" cy="8" r="7" stroke="#ffb4ab" strokeWidth="1" fill="none" opacity="0.6" />
                <text x="8" y="12" textAnchor="middle" fill="#ffb4ab" fontSize="11" fontWeight="600">!</text>
              </svg>
              <span className="font-mono-label text-mono-label text-neutral-400">SYSTEM.DIAGNOSTIC</span>
            </div>
            <table className="w-full font-code text-code text-neutral-300">
              <tbody>
                <tr>
                  <td className="text-neutral-500 py-1 pr-md whitespace-nowrap align-top">STATUS:</td>
                  <td className="text-right py-1 whitespace-nowrap">404_NOT_FOUND</td>
                </tr>
                <tr>
                  <td className="text-neutral-500 py-1 pr-md whitespace-nowrap align-top">TIMESTAMP:</td>
                  <td className="text-right py-1 whitespace-nowrap">{timestamp || "—"}</td>
                </tr>
                <tr>
                  <td className="text-neutral-500 py-1 pr-md whitespace-nowrap align-top">REQUEST_ID:</td>
                  <td className="text-right py-1 whitespace-nowrap">req_7x9k2m4n</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Contact Info */}
          <div className="font-body-sm text-body-sm text-neutral-500">
            <p>If you believe this is a system error, contact us at <a className="text-white hover:underline transition-all" href="mailto:auth@pitchy.pro">auth@pitchy.pro</a></p>
          </div>

          {/* Return Button */}
          <div className="pt-lg">
            <Link
              className="inline-flex items-center gap-2 bg-white text-black px-md py-sm hover:bg-white/90 transition-all font-mono-label text-mono-label uppercase cursor-pointer"
              href="/"
            >
              <ArrowLeft size={14} strokeWidth={2} />
              <span>Return to Root</span>
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.08] py-lg px-6 flex justify-between items-center font-mono-label text-mono-label text-neutral-600 bg-[#0A0A0A]">
        <div>PITCHY.PRO © {new Date().getFullYear()}</div>
        <div className="flex gap-md">
          <Link className="hover:text-white transition-colors" href="#">STATUS</Link>
          <Link className="hover:text-white transition-colors" href="/terms">TERMS</Link>
          <Link className="hover:text-white transition-colors" href="/privacy">PRIVACY</Link>
        </div>
      </footer>
    </div>
  );
}
