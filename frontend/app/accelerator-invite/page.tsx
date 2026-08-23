"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

import { describeApiError, postJson } from "@/lib/api";

function InvitationForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!token) return setError("В ссылке отсутствует код приглашения");
    if (password !== confirmation) return setError("Пароли не совпадают");
    setSubmitting(true);
    try {
      await postJson(`/api/accelerators/public/invitations/${encodeURIComponent(token)}/accept`, { password });
      setAccepted(true);
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось активировать аккаунт"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-black text-white grid place-items-center px-4">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-9">
        {accepted ? (
          <div className="text-center"><CheckCircle2 className="mx-auto mb-5 h-12 w-12 text-emerald-400" /><h1 className="text-3xl mb-4">Аккаунт активирован</h1><p className="mb-8 text-white/50">Теперь вы можете войти в Pitchy и открыть пространство акселератора.</p><Link href="/login?next=/accelerator" className="block rounded-full bg-white px-5 py-3 font-semibold text-black">Войти</Link></div>
        ) : (
          <form onSubmit={submit}>
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-white/35">Приглашение резидента</p>
            <h1 className="text-3xl sm:text-4xl tracking-tight">Создайте пароль</h1>
            <p className="mt-4 mb-8 text-sm leading-relaxed text-white/50">Он будет использоваться для единого аккаунта Pitchy. Минимум 8 символов, буквы и цифры.</p>
            <label className="mb-5 block text-sm text-white/70">Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} required autoComplete="new-password" className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-white/35" /></label>
            <label className="mb-6 block text-sm text-white/70">Повторите пароль<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} maxLength={72} required autoComplete="new-password" className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-white/35" /></label>
            {error && <p role="alert" className="mb-5 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
            <button disabled={submitting || !token} className="flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 font-semibold text-black disabled:opacity-40">{submitting && <Loader2 size={17} className="animate-spin" />} Активировать аккаунт</button>
          </form>
        )}
      </section>
    </main>
  );
}

export default function AcceleratorInvitationPage() {
  return <Suspense fallback={<main className="min-h-[100dvh] bg-black grid place-items-center"><Loader2 className="animate-spin text-white/50" /></main>}><InvitationForm /></Suspense>;
}
