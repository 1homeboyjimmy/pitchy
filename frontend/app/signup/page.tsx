"use client";

import { useState, Suspense } from "react";
import { UserRound, Mail, KeyRound, LogIn, CircleUser, TerminalSquare } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { postJson } from "@/lib/api";
import { setToken } from "@/lib/auth";

function SignUpContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Verification step state
  const [verificationStep, setVerificationStep] = useState<"signup" | "verify">("signup");
  const [verificationCode, setVerificationCode] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const data = await postJson<{ status?: string; token?: string; email?: string }>(
        "/auth/register",
        {
          name: formData.name,
          email: formData.email,
          password: formData.password,
        }
      );

      if (data.status === "verification_required") {
        setVerificationStep("verify");
      } else if (data.token) {
        setToken(data.token);
        const next = searchParams.get("next") || "/dashboard";
        router.push(next);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Ошибка регистрации. Попробуйте ещё раз."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const data = await postJson<{ access_token: string }>("/auth/verify-email", {
        email: formData.email,
        code: verificationCode,
      });
      setToken(data.access_token);
      const next = searchParams.get("next") || "/dashboard";
      router.push(next);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Неверный код подтверждения"
      );
    } finally {
      setLoading(false);
    }
  };

  // ── Verification Step ──
  if (verificationStep === "verify") {
    return (
      <div className="text-on-background min-h-screen flex items-center justify-center p-md relative">
        <div className="w-full max-w-[400px] relative z-10">
          <div className="text-center mb-xl">
            <h1 className="font-display text-display text-primary tracking-tighter mb-sm">PITCHY.PRO</h1>
            <p className="font-code text-code text-[#888888] uppercase">Подтверждение Email</p>
          </div>
          <div className="bg-[#111111] hairline-border p-lg text-center">
            <p className="font-body-sm text-body-sm text-[#888888] mb-lg">
              Мы отправили код подтверждения на{" "}
              <span className="text-primary">{formData.email}</span>
            </p>

            {error && (
              <div className="p-sm mb-lg border border-error/20 bg-error/5 text-error text-body-sm font-body-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-lg">
              <input
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                className="w-full bg-[#111111] hairline-border text-primary text-center text-[24px] tracking-[0.5em] font-code py-sm input-focus placeholder-[#444444]"
                placeholder="000000"
                maxLength={6}
                required
                autoFocus
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-on-primary font-body-sm text-body-sm font-medium py-sm hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
              >
                {loading ? "Проверка..." : "Подтвердить"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ── Registration Form ──
  return (
    <div className="text-on-background min-h-screen flex items-center justify-center p-md relative">

      <div className="w-full max-w-[400px] relative z-10">
        {/* Brand / Header */}
        <div className="text-center mb-xl">
          <h1 className="font-display text-display text-primary tracking-tighter mb-sm">PITCHY.PRO</h1>
          <p className="font-code text-code text-[#888888] uppercase">Создание аккаунта системы</p>
        </div>

        {/* Registration Form Card */}
        <div className="bg-[#111111] hairline-border p-lg">
          {/* Error message */}
          {error && (
            <div className="p-sm mb-lg border border-error/20 bg-error/5 text-error text-body-sm font-body-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-lg">
            {/* Name Field */}
            <div>
              <label className="block font-mono-label text-mono-label text-[#888888] uppercase mb-sm" htmlFor="name">
                Имя
              </label>
              <div className="relative">
                <UserRound className="absolute left-sm top-1/2 -translate-y-1/2 text-[#444444]" size={18} strokeWidth={1.5} />
                <input
                  className="w-full bg-[#111111] hairline-border text-primary font-body-sm text-body-sm pl-xl py-sm input-focus placeholder-[#444444]"
                  id="name"
                  name="name"
                  placeholder="Иван Иванов"
                  required
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
            </div>

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
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label className="block font-mono-label text-mono-label text-[#888888] uppercase mb-sm" htmlFor="password">
                Пароль
              </label>
              <div className="relative">
                <KeyRound className="absolute left-sm top-1/2 -translate-y-1/2 text-[#444444]" size={18} strokeWidth={1.5} />
                <input
                  className="w-full bg-[#111111] hairline-border text-primary font-body-sm text-body-sm pl-xl py-sm input-focus placeholder-[#444444]"
                  id="password"
                  name="password"
                  placeholder="••••••••"
                  required
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                />
              </div>
            </div>

            {/* Confirm Password Field */}
            <div>
              <label className="block font-mono-label text-mono-label text-[#888888] uppercase mb-sm" htmlFor="password_confirm">
                Подтверждение пароля
              </label>
              <div className="relative">
                <KeyRound className="absolute left-sm top-1/2 -translate-y-1/2 text-[#444444]" size={18} strokeWidth={1.5} />
                <input
                  className="w-full bg-[#111111] hairline-border text-primary font-body-sm text-body-sm pl-xl py-sm input-focus placeholder-[#444444]"
                  id="password_confirm"
                  name="password_confirm"
                  placeholder="••••••••"
                  required
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                />
              </div>
            </div>

            {/* Submit Button */}
            <button
              className="w-full bg-primary text-on-primary font-body-sm text-body-sm font-medium py-sm hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex justify-center items-center gap-sm"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-sm">
                  <div className="w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
                  Регистрация...
                </span>
              ) : (
                "Зарегистрироваться"
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
            Уже есть аккаунт?{" "}
            <Link
              className="text-primary hover:underline underline-offset-4 decoration-white/30"
              href={searchParams?.get("next") ? `/login?next=${encodeURIComponent(searchParams.get("next")!)}` : "/login"}
            >
              Войти
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin"></div>
      </div>
    }>
      <SignUpContent />
    </Suspense>
  );
}
