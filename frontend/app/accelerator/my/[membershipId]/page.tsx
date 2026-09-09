"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BriefcaseBusiness, Loader2, Rocket } from "lucide-react";
import { useParams } from "next/navigation";

import { describeApiError, getAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { NotificationCenter } from "@/components/accelerator/NotificationCenter";
import { ResidentMembershipView, type ResidentWorkspaceData } from "@/components/accelerator/ResidentWorkspace";
import { staffAccelerators, type AcceleratorAccess } from "@/lib/acceleratorAccess";

export default function ResidentAcceleratorPage() {
  const { membershipId } = useParams<{ membershipId: string }>();
  const { token, isLoaded } = useAuth();
  const [data, setData] = useState<ResidentWorkspaceData | null>(null);
  const [accelerators, setAccelerators] = useState<AcceleratorAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const numericMembershipId = Number(membershipId);
  const hasValidMembershipId = Number.isInteger(numericMembershipId) && numericMembershipId > 0;

  const load = useCallback(async () => {
    if (!token || !hasValidMembershipId) return;
    try {
      const [workspace, access] = await Promise.all([
        getAuthJson<ResidentWorkspaceData>("/api/accelerators/me/memberships", token),
        getAuthJson<AcceleratorAccess[]>("/api/accelerators", token),
      ]);
      setData(workspace);
      setAccelerators(access);
      setError("");
    }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить кабинет участника")); }
    finally { setLoading(false); }
  }, [hasValidMembershipId, token]);

  useEffect(() => { void load(); }, [load]);
  const membership = data?.memberships.find((row) => row.membership_id === numericMembershipId) || null;
  const serviceAccelerator = staffAccelerators(accelerators).find((row) => row.id === membership?.accelerator.id) || staffAccelerators(accelerators)[0] || null;

  if (!isLoaded || (loading && hasValidMembershipId && token)) return <main className="grid min-h-[100dvh] place-items-center bg-black text-white"><Loader2 className="animate-spin text-white/35" /></main>;
  if (!token) return <main className="grid min-h-[100dvh] place-items-center bg-black px-5 text-white"><section className="text-center"><h1 className="text-3xl">Нужно войти</h1><Link href={`/login?next=/accelerator/my/${numericMembershipId}`} className="workspace-button mt-6">Войти</Link></section></main>;

  return <main className="min-h-[100dvh] bg-black px-4 py-7 text-white sm:px-8 sm:py-10"><div className="mx-auto max-w-7xl">
    <header className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white"><ArrowLeft size={15} /> В дашборд</Link><div className="mt-4 flex items-center gap-3"><Rocket className="text-white/45" /><h1 className="text-3xl tracking-tight sm:text-5xl">Моё участие</h1></div></div><div className="flex flex-wrap items-center justify-end gap-2">{serviceAccelerator && <Link href={`/accelerator?context=staff&accelerator=${serviceAccelerator.id}`} className="workspace-button"><BriefcaseBusiness size={15} /> Служебный кабинет</Link>}<NotificationCenter token={token} /></div></header>
    {error && <div role="alert" className="mb-6 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>}
    {membership ? <ResidentMembershipView membership={membership} quotas={data?.effective_quotas || {}} onChanged={load} /> : <section className="workspace-card py-12 text-center"><h2 className="text-2xl">Участие не найдено</h2><p className="mt-3 text-white/40">Возможно, доступ был изменён. Вернитесь в основной дашборд.</p><Link href="/dashboard" className="workspace-button mt-6">Вернуться</Link></section>}
  </div></main>;
}
