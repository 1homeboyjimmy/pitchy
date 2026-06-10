"use client";

import { useState, Suspense } from "react";
import { Mail, KeyRound, ArrowRight, ShieldCheck, Github } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PitchyLogo } from "@/components/shared/PitchyLogo";
import { postJson } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { YandexIcon } from "@/components/shared/icons/YandexIcon";

function LoginContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const data = await postJson<{ access_token: string }>("/auth/login", {
        email,
        password,
      });
      setToken(data.access_token);
      const next = searchParams?.get("next") || "/dashboard";
      router.push(next);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Ошибка входа. Попробуйте ещё раз."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-black text-foreground min-h-screen flex items-center justify-center p-6 relative overflow-hidden antialiased">
      {/* Decorative Orbs */}
      <div className="aurora-orb top-[-10rem] right-[-10rem] h-96 w-96 bg-white/[0.04] animate-pulse" />
      <div className="aurora-orb bottom-[-5rem] left-[-5rem] h-80 w-80 bg-white/[0.02] animate-float-slow" />

      <div className="w-full max-w-[800px] relative z-10">
        {/* Brand / Header */}
        <div className="text-center mb-12">
          <Link href="/" className="inline-block mb-8">
            <PitchyLogo size="3xl" />
          </Link>
          <h2 className="text-6xl md:text-8xl text-white tracking-tighter leading-[0.9] mb-4 font-display">
            Авторизация <br />
            <span className="text-white/30 italic">системы</span>.
          </h2>
        </div>

        {/* Login Form Card */}
        <div className="lovable-glass rounded-[40px] p-10 md:p-12 shadow-2xl relative overflow-hidden group max-w-[480px] mx-auto">
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
          
          {/* Session expired warning */}
          {searchParams?.get("expired") && (
            <div className="p-4 mb-8 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm font-medium flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Сессия истекла. Пожалуйста, войдите снова.
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="p-4 mb-8 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm font-medium flex items-center gap-3">
               <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-8 relative z-10">
            {/* Email Field */}
            <div className="space-y-3">
              <label className="block font-mono-label text-[11px] text-white/40 uppercase tracking-[0.2em] ml-1" htmlFor="email">
                Идентификатор (Email)
              </label>
              <div className="relative">
                <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-white/20" size={18} />
                <input
                  className="w-full bg-white/5 border border-white/10 text-white rounded-2xl pl-14 pr-6 py-4 font-body-sm text-[16px] focus:outline-none focus:border-white/30 transition-all placeholder:text-white/10"
                  id="email"
                  name="email"
                  placeholder="user@pitchy.pro"
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-3">
              <div className="flex justify-between items-center ml-1">
                <label className="block font-mono-label text-[11px] text-white/40 uppercase tracking-[0.2em]" htmlFor="password">
                  Ключ доступа
                </label>
                <Link className="font-mono-label text-[10px] text-white/20 hover:text-white transition-colors uppercase tracking-widest" href="#">
                  Забыли?
                </Link>
              </div>
              <div className="relative">
                <KeyRound className="absolute left-5 top-1/2 -translate-y-1/2 text-white/20" size={18} />
                <input
                  className="w-full bg-white/5 border border-white/10 text-white rounded-2xl pl-14 pr-6 py-4 font-body-sm text-[16px] focus:outline-none focus:border-white/30 transition-all placeholder:text-white/10"
                  id="password"
                  name="password"
                  placeholder="••••••••"
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            {/* Primary Action */}
            <button
              className="w-full bg-white text-black font-bold text-sm uppercase tracking-tighter py-5 rounded-full hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-3 shadow-[0_0_40px_rgba(255,255,255,0.1)]"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-3">
                  <div className="w-5 h-5 border-3 border-black/10 border-t-black rounded-full animate-spin" />
                  Вход...
                </span>
              ) : (
                <>
                  <span>Войти в систему</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center my-12 opacity-20">
            <div className="flex-grow h-px bg-white"></div>
            <span className="mx-6 font-mono-label text-[10px] text-white uppercase tracking-[0.5em]">OR</span>
            <div className="flex-grow h-px bg-white"></div>
          </div>

          {/* SSO Options — forward ?next= so the OAuth round-trip
              returns the user to the page they originally wanted. */}
          {(() => {
            const nextParam = searchParams?.get("next");
            const ssoSuffix = nextParam ? `?next=${encodeURIComponent(nextParam)}` : "";
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-10">
                <a
                  href={`/auth/yandex/login${ssoSuffix}`}
                  className="flex items-center justify-center gap-3 bg-white/5 border border-white/10 text-white py-4 rounded-full hover:bg-white/10 hover:border-white/20 transition-all font-sans text-xs font-bold uppercase tracking-tight"
                >
                  <YandexIcon size={16} /> Yandex
                </a>
                <a
                  href={`/auth/github/login${ssoSuffix}`}
                  className="flex items-center justify-center gap-3 bg-white/5 border border-white/10 text-white py-4 rounded-full hover:bg-white/10 hover:border-white/20 transition-all font-sans text-xs font-bold uppercase tracking-tight"
                >
                  <Github size={16} /> GitHub
                </a>
              </div>
            );
          })()}
        </div>

        {/* Footer / Helper */}
        <div className="text-center mt-12">
          <p className="font-body-sm text-[15px] text-white/30">
            Нет аккаунта?{" "}
            <Link
              className="text-white hover:text-white/80 transition-colors underline underline-offset-8 decoration-white/20"
              href={searchParams?.get("next") ? `/signup?next=${encodeURIComponent(searchParams.get("next")!)}` : "/signup"}
            >
              Запросить доступ
            </Link>
          </p>
        </div>
      </div>
      
      {/* Visual Accents */}
      <div className="fixed bottom-0 right-0 p-12 pointer-events-none z-0">
        <div className="text-[140px] font-black text-white/[0.01] leading-none select-none tracking-tighter uppercase">Login</div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex flex-col items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-white/5 border-t-white animate-spin"></div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
