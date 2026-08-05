"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { postJson } from "@/lib/api";
import { setToken } from "@/lib/auth";

function VerifyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const email = searchParams?.get("email") || "";

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const newDigits = [...digits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = pasted[i] || "";
    }
    setDigits(newDigits);
    const lastIndex = Math.min(pasted.length, 5);
    inputRefs.current[lastIndex]?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = digits.join("");
    if (code.length !== 6) {
      setError("Введите все 6 цифр");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await postJson<{ access_token: string }>("/auth/verify-email", {
        email,
        code,
      });
      setToken(data.access_token);
      const next = searchParams?.get("next") || "/dashboard";
      router.push(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неверный код подтверждения");
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    try {
      await postJson("/auth/resend-code", { email });
      setResendCooldown(60);
    } catch {
      setError("Не удалось отправить код повторно");
    }
  };

  return (
    <div className="text-on-surface min-h-[100dvh] flex items-center justify-center p-3 sm:p-4">
      {/* Verification Card */}
      <div className="w-full max-w-[420px] bg-[#111111] border border-white/10 rounded-lg p-5 sm:p-8 relative group">
        {/* Hover glow */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-lg"
          style={{ background: "radial-gradient(600px circle at 50% 0%, rgba(255,255,255,0.03), transparent 40%)" }}
        />

        <div className="relative z-10 flex flex-col items-center text-center">
          {/* Lock Icon */}
          <div className="mb-6 p-4 bg-white/5 rounded border border-white/10 inline-flex items-center justify-center">
            <Lock size={32} strokeWidth={1.2} className="text-primary" />
          </div>

          <h1 className="font-h1 text-h1 text-primary mb-2 tracking-tight">Подтвердите почту</h1>
          <p className="text-[16px] leading-relaxed text-[#c4c7c8] mb-10 max-w-[280px]">
            Мы отправили 6-значный код на ваш email.
          </p>

          {/* Error */}
          {error && (
            <div className="w-full p-2 mb-4 border border-error/20 bg-error/5 text-error text-[14px] text-left rounded">
              {error}
            </div>
          )}

          {/* 6-Digit Input Form */}
          <form className="w-full flex flex-col gap-6" onSubmit={handleSubmit}>
            <div className="flex justify-center gap-1.5 sm:gap-2" onPaste={handlePaste}>
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  aria-label={`Digit ${i + 1}`}
                  className="h-12 w-10 sm:h-14 sm:w-12 bg-[#111111] border border-white/10 rounded text-center text-primary font-code text-[18px] sm:text-[20px] focus:border-white/40 focus:ring-0 focus:outline-none transition-colors"
                  maxLength={1}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={digit}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                />
              ))}
            </div>

            <button
              className="w-full h-12 bg-primary text-[#0A0A0A] text-[14px] font-medium rounded hover:opacity-90 transition-opacity flex justify-center items-center cursor-pointer disabled:opacity-50"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-[#0A0A0A]/30 border-t-[#0A0A0A] rounded-full animate-spin" />
                  Проверка...
                </span>
              ) : (
                "Подтвердить"
              )}
            </button>
          </form>

          {/* Resend Link */}
          <div className="mt-6">
            <button
              className="font-code text-[13px] text-[#888888] hover:text-white transition-colors uppercase tracking-widest cursor-pointer disabled:opacity-50"
              type="button"
              onClick={handleResend}
              disabled={resendCooldown > 0}
            >
              {resendCooldown > 0
                ? `Повторить через ${resendCooldown}с`
                : "Отправить код повторно"
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin"></div>
      </div>
    }>
      <VerifyContent />
    </Suspense>
  );
}
