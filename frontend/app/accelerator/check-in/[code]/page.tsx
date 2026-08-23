"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2, LogIn, XCircle } from "lucide-react";

import { describeApiError, postAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";

type CheckInResult = { checked_in: boolean; event: { title: string; starts_at: string; location?: string | null } };

export default function AcceleratorCheckInPage() {
  const { code } = useParams<{ code: string }>();
  const { token, isLoaded } = useAuth();
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!isLoaded || !token) return;
    postAuthJson<CheckInResult>(`/api/accelerators/attendance/check-in/${encodeURIComponent(code)}`, {}, token)
      .then(setResult).catch((reason) => setError(describeApiError(reason, "Не удалось отметить посещение"))).finally(() => setLoading(false));
  }, [code, isLoaded, token]);
  if (!isLoaded) return <main className="min-h-[100dvh] grid place-items-center bg-black text-white"><Loader2 className="animate-spin text-white/50" /></main>;
  if (!token) return <State icon={LogIn} title="Сначала войдите в Pitchy" text="После входа эта ссылка отметит ваше посещение."><Link href={`/login?next=${encodeURIComponent(`/accelerator/check-in/${code}`)}`} className="rounded-full bg-white px-6 py-3 font-semibold text-black">Войти</Link></State>;
  if (loading) return <main className="min-h-[100dvh] grid place-items-center bg-black text-white"><Loader2 className="animate-spin text-white/50" /></main>;
  if (error) return <State icon={XCircle} title="Отметка не сохранена" text={error}><Link href="/accelerator" className="text-white underline">Вернуться в акселератор</Link></State>;
  return <State icon={CheckCircle2} title="Посещение отмечено" text={`${result?.event.title || "Мероприятие"} · ${result ? new Date(result.event.starts_at).toLocaleString("ru-RU") : ""}`}><Link href="/accelerator" className="rounded-full bg-white px-6 py-3 font-semibold text-black">Открыть акселератор</Link></State>;
}

function State({ icon: Icon, title, text, children }: { icon: typeof CheckCircle2; title: string; text: string; children: React.ReactNode }) {
  return <main className="min-h-[100dvh] grid place-items-center bg-black px-5 text-white"><section className="max-w-xl rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center sm:p-12"><Icon className="mx-auto mb-6 h-12 w-12 text-white/55" /><h1 className="text-3xl sm:text-5xl">{title}</h1><p className="my-6 text-white/50">{text}</p>{children}</section></main>;
}
