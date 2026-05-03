"use client";

import { useState, Suspense } from "react";
import { UserRound, Mail, KeyRound, ArrowRight, ShieldCheck, Github, Chrome, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PitchyLogo } from "@/components/shared/PitchyLogo";
import { postJson } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { YandexIcon } from "@/components/shared/icons/YandexIcon";

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

  // Common Wrapper for Auth Cards
  const AuthWrapper = ({ children, title, subtitle, icon: Icon }: any) => (
    <div className="bg-black text-foreground min-h-screen flex items-center justify-center p-6 relative overflow-hidden antialiased">
      {/* Decorative Orbs */}
      <div className="aurora-orb top-[-10rem] left-[-10rem] h-96 w-96 bg-white/[0.04] animate-pulse" />
      <div className="aurora-orb bottom-[-5rem] right-[-5rem] h-80 w-80 bg-white/[0.02] animate-float-slow" />

      <div className="w-full max-w-[900px] relative z-10">
        <div className="text-center mb-12">
          <Link href="/" className="inline-block mb-8">
            <PitchyLogo size="3xl" />
          </Link>
          <h2 className="text-6xl md:text-8xl text-white tracking-tighter leading-[0.9] mb-4" style={{ fontFamily: "'Instrument Serif', serif" }}>
            {title.split(' ')[0]} <br />
            <span className="text-white/30 italic">{title.split(' ').slice(1).join(' ')}</span>.
          </h2>
        </div>

        <div className="lovable-glass rounded-[40px] p-10 md:p-12 shadow-2xl relative overflow-hidden group max-w-[540px] mx-auto">
           <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
           {children}
        </div>
      </div>
      
      {/* Visual Accents */}
      <div className="fixed bottom-0 right-0 p-12 pointer-events-none z-0">
        <div className="text-[140px] font-black text-white/[0.01] leading-none select-none tracking-tighter uppercase">Join</div>
      </div>
    </div>
  );

  // ── Verification Step ──
  if (verificationStep === "verify") {
    return (
      <AuthWrapper title="Подтверждение почты" subtitle="SECURITY VERIFICATION" icon={ShieldCheck}>
        <div className="text-center relative z-10">
          <p className="font-body-sm text-[16px] text-white/50 mb-10 leading-relaxed">
            Мы отправили код подтверждения на <br/>
            <span className="text-white font-bold">{formData.email}</span>
          </p>

          {error && (
            <div className="p-4 mb-8 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm font-medium flex items-center gap-3">
               <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {error}
            </div>
          )}

          <form onSubmit={handleVerify} className="space-y-8">
            <input
              type="text"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              className="w-full bg-white/5 border border-white/10 text-white text-center text-[32px] tracking-[0.5em] font-display py-6 rounded-2xl focus:outline-none focus:border-white/30 transition-all placeholder:text-white/10"
              placeholder="000000"
              maxLength={6}
              required
              autoFocus
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white text-black font-bold text-sm uppercase tracking-tighter py-5 rounded-full hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-3 shadow-[0_0_40px_rgba(255,255,255,0.1)]"
            >
              {loading ? "ПРОВЕРКА..." : "ПОДТВЕРДИТЬ КЛЮЧ"}
            </button>
          </form>
          
          <button 
            onClick={() => setVerificationStep("signup")}
            className="mt-8 font-mono-label text-[10px] text-white/20 hover:text-white transition-colors uppercase tracking-[0.2em]"
          >
            Изменить email
          </button>
        </div>
      </AuthWrapper>
    );
  }

  // ── Registration Form ──
  return (
    <AuthWrapper title="Регистрация в системе" subtitle="ACCESS REQUEST">
        {/* Error message */}
        {error && (
          <div className="p-4 mb-8 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm font-medium flex items-center gap-3">
             <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
          {/* Name Field */}
          <div className="space-y-2">
            <label className="block font-mono-label text-[11px] text-white/40 uppercase tracking-[0.2em] ml-1" htmlFor="name">
              Полное имя
            </label>
            <div className="relative">
              <UserRound className="absolute left-5 top-1/2 -translate-y-1/2 text-white/20" size={18} />
              <input
                className="w-full bg-white/5 border border-white/10 text-white rounded-2xl pl-14 pr-6 py-4 font-body-sm text-[16px] focus:outline-none focus:border-white/30 transition-all placeholder:text-white/10"
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
          <div className="space-y-2">
            <label className="block font-mono-label text-[11px] text-white/40 uppercase tracking-[0.2em] ml-1" htmlFor="email">
              Email адрес
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
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Password Field */}
            <div className="space-y-2">
              <label className="block font-mono-label text-[11px] text-white/40 uppercase tracking-[0.2em] ml-1" htmlFor="password">
                Пароль
              </label>
              <div className="relative">
                <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={16} />
                <input
                  className="w-full bg-white/5 border border-white/10 text-white rounded-2xl pl-12 pr-4 py-3 font-body-sm text-[14px] focus:outline-none focus:border-white/30 transition-all placeholder:text-white/10"
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
            <div className="space-y-2">
              <label className="block font-mono-label text-[11px] text-white/40 uppercase tracking-[0.2em] ml-1" htmlFor="password_confirm">
                Проверка
              </label>
              <div className="relative">
                <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={16} />
                <input
                  className="w-full bg-white/5 border border-white/10 text-white rounded-2xl pl-12 pr-4 py-3 font-body-sm text-[14px] focus:outline-none focus:border-white/30 transition-all placeholder:text-white/10"
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
          </div>

          {/* Submit Button */}
          <button
            className="w-full bg-white text-black font-bold text-sm uppercase tracking-tighter py-5 rounded-full hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-3 shadow-[0_0_40px_rgba(255,255,255,0.1)] mt-4"
            type="submit"
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-3">
                <div className="w-5 h-5 border-3 border-black/10 border-t-black rounded-full animate-spin" />
                СОЗДАНИЕ...
              </span>
            ) : (
              <>
                <span>Запросить доступ</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="flex items-center my-10 opacity-20">
          <div className="flex-grow h-px bg-white"></div>
          <span className="mx-6 font-mono-label text-[10px] text-white uppercase tracking-[0.5em]">OR</span>
          <div className="flex-grow h-px bg-white"></div>
        </div>

        {/* SSO Options */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 relative z-10">
          <a
            href="/auth/yandex/login"
            className="flex items-center justify-center gap-3 bg-white/5 border border-white/10 text-white py-4 rounded-full hover:bg-white/10 hover:border-white/20 transition-all font-sans text-xs font-bold uppercase tracking-tight"
          >
            <YandexIcon size={16} /> Yandex
          </a>
          <a
            href="/auth/google/login"
            className="flex items-center justify-center gap-3 bg-white/5 border border-white/10 text-white py-4 rounded-full hover:bg-white/10 hover:border-white/20 transition-all font-sans text-xs font-bold uppercase tracking-tight"
          >
            <Chrome size={16} /> Google
          </a>
          <a
            href="/auth/github/login"
            className="flex items-center justify-center gap-3 bg-white/5 border border-white/10 text-white py-4 rounded-full hover:bg-white/10 hover:border-white/20 transition-all font-sans text-xs font-bold uppercase tracking-tight"
          >
            <Github size={16} /> GitHub
          </a>
        </div>

        {/* Footer / Helper */}
        <div className="text-center mt-12">
          <p className="font-body-sm text-[15px] text-white/30">
            Уже есть аккаунт?{" "}
            <Link
              className="text-white hover:text-white/80 transition-colors underline underline-offset-8 decoration-white/20"
              href={searchParams?.get("next") ? `/login?next=${encodeURIComponent(searchParams.get("next")!)}` : "/login"}
            >
              Войти
            </Link>
          </p>
        </div>
    </AuthWrapper>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex flex-col items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-white/5 border-t-white animate-spin"></div>
      </div>
    }>
      <SignUpContent />
    </Suspense>
  );
}
