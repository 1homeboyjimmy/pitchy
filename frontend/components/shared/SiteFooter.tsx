import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="w-full border-t border-white/[0.08] py-8 bg-[#0A0A0A] mt-auto">
      <div className="max-w-[1440px] mx-auto flex flex-col md:flex-row justify-between items-center px-6 md:px-12 gap-4">
        <div className="text-white font-black text-[12px] tracking-tight">PITCHY.PRO</div>
        <div className="font-mono text-[10px] uppercase tracking-tight text-neutral-500">
          © {new Date().getFullYear()} PITCHY.PRO SYSTEM v1.0.4. STABLE BUILD.
        </div>
        <div className="flex gap-6">
          <Link className="font-mono text-[10px] uppercase tracking-tight text-neutral-600 hover:text-white underline decoration-neutral-700 transition-all duration-200" href="/terms">Legal</Link>
          <Link className="font-mono text-[10px] uppercase tracking-tight text-neutral-600 hover:text-white underline decoration-neutral-700 transition-all duration-200" href="/privacy">Privacy</Link>
          <Link className="font-mono text-[10px] uppercase tracking-tight text-neutral-600 hover:text-white underline decoration-neutral-700 transition-all duration-200" href="#">Security</Link>
          <Link className="font-mono text-[10px] uppercase tracking-tight text-neutral-600 hover:text-white underline decoration-neutral-700 transition-all duration-200" href="#">Status</Link>
        </div>
      </div>
    </footer>
  );
}
