"use client";

import { useState, Suspense } from "react";
import { Mail, KeyRound, LogIn, CircleUser, TerminalSquare } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { postJson } from "@/lib/api";
import { setToken } from "@/lib/auth";

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
    <div className="text-on-background min-h-screen flex items-center justify-center p-md relative">

      <div className="w-full max-w-[400px] relative z-10">
        {/* Brand / Header */}
        <div className="text-center mb-xl">
          <h1 className="font-display text-display text-primary tracking-tighter mb-sm">PITCHY.PRO</h1>
          <p className="font-code text-code text-[#888888]">СИСТЕМА АВТОРИЗАЦИИ</p>
        </div>

        {/* Login Form Card */}
        <div className="bg-[#111111] hairline-border p-lg">
          {/* Session expired warning */}
          {searchParams?.get("expired") && (
            <div className="p-sm mb-lg border border-error/20 bg-error/5 text-error text-body-sm font-body-sm">
              Сессия истекла. Пожалуйста, войдите снова.
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="p-sm mb-lg border border-error/20 bg-error/5 text-error text-body-sm font-body-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-lg">
            {/* Email Field */}
            <div>
              <label className="block font-mono-label text-mono-label text-[#888888] uppercase mb-sm" htmlFor="email">
                Email адрес
              </label>
              <div className="relative">
                <Mail className="absolute left-sm top-1/2 -translate-y-1/2 text-[#444444]" size={18} strokeWidth={1.5} />
                <input
                  className="w-full bg-[#111111] hairline-border text-primary font-body-sm text-body-sm pl-xl py-sm input-focus placeholder-[#444444]"
                  id="email"
                  name="email"
                  placeholder="user@domain.com"
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <div className="flex justify-between items-center mb-sm">
                <label className="block font-mono-label text-mono-label text-[#888888] uppercase" htmlFor="password">
                  Пароль
                </label>
                <Link className="font-mono-label text-mono-label text-[#888888] hover:text-primary transition-colors" href="#">
                  Забыли?
                </Link>
              </div>
              <div className="relative">
                <KeyRound className="absolute left-sm top-1/2 -translate-y-1/2 text-[#444444]" size={18} strokeWidth={1.5} />
                <input
                  className="w-full bg-[#111111] hairline-border text-primary font-body-sm text-body-sm pl-xl py-sm input-focus placeholder-[#444444]"
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
              className="w-full bg-primary text-on-primary font-body-sm text-body-sm font-medium py-sm hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-sm">
                  <div className="w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
                  Вход...
                </span>
              ) : (
                "Войти в систему"
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center my-lg">
            <div className="flex-grow border-t border-white/[0.08]"></div>
            <span className="mx-md font-mono-label text-mono-label text-[#444444]">ИЛИ</span>
            <div className="flex-grow border-t border-white/[0.08]"></div>
          </div>

          {/* SSO Options */}
          <div className="space-y-sm">
            {/* Yandex */}
            <a
              href="/auth/yandex/login"
              className="w-full bg-transparent hairline-border text-primary font-body-sm text-body-sm py-sm hover:bg-white/[0.05] transition-colors flex items-center justify-center gap-sm cursor-pointer"
            >
              <img src="/icons/yandex_icon.png" alt="Yandex" className="w-[18px] h-[18px] object-contain" />
              Продолжить с Яндекс
            </a>
            {/* Google */}
            <a
              href="/auth/google/login"
              className="w-full bg-transparent hairline-border text-primary font-body-sm text-body-sm py-sm hover:bg-white/[0.05] transition-colors flex items-center justify-center gap-sm cursor-pointer"
            >
              <img src="/icons/google_icon.png" alt="Google" className="w-[18px] h-[18px] object-contain" />
              Продолжить с Google
            </a>
            {/* GitHub */}
            <a
              href="/auth/github/login"
              className="w-full bg-transparent hairline-border text-primary font-body-sm text-body-sm py-sm hover:bg-white/[0.05] transition-colors flex items-center justify-center gap-sm cursor-pointer"
            >
              <img src="/icons/github_icon.png" alt="GitHub" className="w-[18px] h-[18px] object-contain" />
              Продолжить с GitHub
            </a>
          </div>
        </div>

        {/* Footer / Helper */}
        <div className="text-center mt-lg">
          <p className="font-code text-code text-[#888888]">
            Нет аккаунта?{" "}
            <Link
              className="text-primary hover:underline underline-offset-4 decoration-white/30"
              href={searchParams?.get("next") ? `/signup?next=${encodeURIComponent(searchParams.get("next")!)}` : "/signup"}
            >
              Запросить доступ
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin"></div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
