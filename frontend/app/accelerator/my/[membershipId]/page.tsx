"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Rocket } from "lucide-react";
import { useParams } from "next/navigation";

import { describeApiError, getAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { NotificationCenter } from "@/components/accelerator/NotificationCenter";
import { ResidentMembershipView, type ResidentWorkspaceData } from "@/components/accelerator/ResidentWorkspace";

export default function ResidentAcceleratorPage() {
  const { membershipId } = useParams<{ membershipId: string }>();
  const { token, isLoaded } = useAuth();
  const [data, setData] = useState<ResidentWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const numericMembershipId = Number(membershipId);
  const hasValidMembershipId = Number.isInteger(numericMembershipId) && numericMembershipId > 0;

  const load = useCallback(async () => {
    if (!token || !hasValidMembershipId) return;
    try {
      setData(await getAuthJson<ResidentWorkspaceData>("/api/accelerators/me/memberships", token));
      setError("");
    }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить кабинет участника")); }
    finally { setLoading(false); }
  }, [hasValidMembershipId, token]);

  useEffect(() => { void load(); }, [load]);
  const membership = data?.memberships.find((row) => row.membership_id === numericMembershipId) || null;

  if (!isLoaded || (loading && hasValidMembershipId && token)) return <main className="grid min-h-[100dvh] place-items-center bg-black text-white"><Loader2 className="animate-spin text-white/35" /></main>;
  if (!token) return <main className="grid min-h-[100dvh] place-items-center bg-black px-5 text-white"><section className="text-center"><h1 className="text-3xl">Нужно войти</h1><Link href={`/login?next=/accelerator/my/${numericMembershipId}`} className="workspace-button mt-6">Войти</Link></section></main>;

  return <main className="min-h-[100dvh] bg-black px-4 py-7 text-white sm:px-8 sm:py-10"><div className="mx-auto max-w-7xl">
    <header className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><Link href="/accelerator" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white"><ArrowLeft size={15} /> Все участия и роли</Link><div className="mt-4 flex items-center gap-3"><Rocket className="text-white/45" /><h1 className="text-3xl tracking-tight sm:text-5xl">Моё участие</h1></div></div><NotificationCenter token={token} /></header>
    {error && <div role="alert" className="mb-6 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>}
    {membership ? <ResidentMembershipView membership={membership} quotas={data?.effective_quotas || {}} onChanged={load} /> : <section className="workspace-card py-12 text-center"><h2 className="text-2xl">Участие не найдено</h2><p className="mt-3 text-white/40">Возможно, доступ был изменён. Вернитесь к списку своих ролей и потоков.</p><Link href="/accelerator" className="workspace-button mt-6">Вернуться</Link></section>}
  </div></main>;
}
