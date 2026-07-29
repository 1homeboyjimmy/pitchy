"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Mail, KeyRound } from "lucide-react";
import { PitchyLogo } from "@/components/shared/PitchyLogo";
import { postJson } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await postJson("/auth/request-password-reset", { email: email.trim() });
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить код. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8 || password.length > 72) {
      setError("Пароль должен содержать от 8 до 72 символов.");
      return;
    }
    if (!/[A-Za-zА-Яа-я]/.test(password) || !/\d/.test(password)) {
      setError("Пароль должен содержать буквы и цифры.");
      return;
    }
    if (password !== confirmation) {
      setError("Пароли не совпадают.");
      return;
    }
    if (code.length !== 6) {
      setError("Введите шестизначный код из письма.");
      return;
    }
    setLoading(true);
    try {
      await postJson("/auth/reset-password", {
        email: email.trim(),
        code,
        new_password: password,
      });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить пароль.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black p-6 text-white">
      <div className="aurora-orb right-[-10rem] top-[-10rem] h-96 w-96 bg-white/[0.04]" />
      <div className="relative z-10 w-full max-w-[480px]">
        <div className="mb-10 text-center">
          <Link href="/" className="inline-block">
            <PitchyLogo size="3xl" />
          </Link>
          <h1 className="mt-8 font-display text-4xl tracking-tight">Восстановление пароля</h1>
          <p className="mt-3 text-sm text-white/40">
            {step === "email" && "Получите код подтверждения на email."}
            {step === "code" && `Код отправлен на ${email}.`}
            {step === "done" && "Новый пароль сохранён."}
          </p>
        </div>

        <section className="lovable-glass rounded-[40px] p-8 shadow-2xl md:p-10">
          {error && (
            <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
              {error}
            </div>
          )}

          {step === "email" && (
            <form onSubmit={requestCode} className="space-y-6">
              <label className="block">
                <span className="mb-3 block font-mono-label text-[10px] uppercase tracking-[0.2em] text-white/40">
                  Email аккаунта
                </span>
                <span className="relative block">
                  <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-white/20" size={18} />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-14 pr-6 outline-none transition-colors focus:border-white/30"
                    placeholder="user@pitchy.pro"
                    required
                    autoFocus
                  />
                </span>
              </label>
              <SubmitButton loading={loading}>Отправить код</SubmitButton>
            </form>
          )}

          {step === "code" && (
            <form onSubmit={resetPassword} className="space-y-5">
              <label className="block">
                <span className="mb-3 block font-mono-label text-[10px] uppercase tracking-[0.2em] text-white/40">
                  Код из письма
                </span>
                <input
                  inputMode="numeric"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-center text-xl tracking-[0.5em] outline-none focus:border-white/30"
                  placeholder="000000"
                  required
                  autoFocus
                />
              </label>
              <PasswordField label="Новый пароль" value={password} onChange={setPassword} />
              <PasswordField label="Повторите пароль" value={confirmation} onChange={setConfirmation} />
              <SubmitButton loading={loading}>Изменить пароль</SubmitButton>
              <button type="button" onClick={() => setStep("email")} className="w-full text-xs text-white/40 hover:text-white">
                Изменить email или отправить код повторно
              </button>
            </form>
          )}

          {step === "done" && (
            <div className="space-y-6 text-center">
              <div className="text-4xl">✓</div>
              <p className="text-emerald-300">Пароль успешно изменён.</p>
              <Link href="/login" className="block w-full rounded-full bg-white py-5 text-sm font-bold text-black">
                Вернуться ко входу
              </Link>
            </div>
          )}
        </section>

        {step !== "done" && (
          <Link href="/login" className="mt-8 block text-center text-sm text-white/40 hover:text-white">
            Вернуться ко входу
          </Link>
        )}
      </div>
    </main>
  );
}

function SubmitButton({ loading, children }: { loading: boolean; children: string }) {
  return (
    <button type="submit" disabled={loading} className="w-full rounded-full bg-white py-5 text-sm font-bold text-black disabled:opacity-50">
      {loading ? "Подождите…" : children}
    </button>
  );
}

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-3 block font-mono-label text-[10px] uppercase tracking-[0.2em] text-white/40">{label}</span>
      <span className="relative block">
        <KeyRound className="absolute left-5 top-1/2 -translate-y-1/2 text-white/20" size={18} />
        <input
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-14 pr-6 outline-none focus:border-white/30"
          minLength={8}
          maxLength={72}
          required
        />
      </span>
    </label>
  );
}
