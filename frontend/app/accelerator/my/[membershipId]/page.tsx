"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BriefcaseBusiness, Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { describeApiError, getAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { NotificationCenter } from "@/components/accelerator/NotificationCenter";
import { PitchyLogo } from "@/components/shared/PitchyLogo";
import { ResidentMembershipView, type ResidentWorkspaceData } from "@/components/accelerator/ResidentWorkspace";
import { participantMemberships, staffAccelerators, type AcceleratorAccess } from "@/lib/acceleratorAccess";

export default function ResidentAcceleratorPage() {
  const router = useRouter();
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
  const memberships = participantMemberships(data?.memberships || []);
  const serviceAccelerator = staffAccelerators(accelerators).find((row) => row.id === membership?.accelerator.id) || staffAccelerators(accelerators)[0] || null;

  if (!isLoaded || (loading && hasValidMembershipId && token)) return <main className="grid min-h-[100dvh] place-items-center bg-black text-white"><Loader2 className="animate-spin text-white/35" /></main>;
  if (!token) return <main className="grid min-h-[100dvh] place-items-center bg-black px-5 text-white"><section className="text-center"><h1 className="text-3xl">Нужно войти</h1><Link href={`/login?next=/accelerator/my/${numericMembershipId}`} className="workspace-button mt-6">Войти</Link></section></main>;

  return <main className="min-h-[100dvh] bg-[#141313] text-[#e5e2e1]">
    <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-white/15 px-4 py-3 sm:px-8">
      <div className="flex min-w-0 items-center gap-4"><Link href="/dashboard" aria-label="В Pitchy"><PitchyLogo size="2xl" /></Link><span className="text-white/25">│</span><span className="truncate text-sm sm:text-base">Акселератор</span>{memberships.length > 1 ? <select aria-label="Поток" value={numericMembershipId} onChange={(event) => router.push(`/accelerator/my/${event.target.value}`)} className="max-w-48 rounded-lg border border-white/15 bg-[#141313] px-3 py-2 text-sm text-white/75">{memberships.map((row) => <option key={row.membership_id} value={row.membership_id}>{row.cohort.name}</option>)}</select> : <span className="hidden rounded-lg border border-white/15 px-3 py-2 text-sm text-white/75 sm:inline">{membership?.cohort.name || "Поток"}</span>}</div>
      <div className="flex items-center gap-3"><span className="hidden text-sm sm:inline">Участник</span><Link href="/dashboard" className="rounded-lg border border-white/20 px-3 py-2 text-sm">Дашборд</Link>{serviceAccelerator && <Link href={"/accelerator?context=staff&accelerator=" + serviceAccelerator.id} className="rounded-lg border border-white/20 px-3 py-2 text-sm"><BriefcaseBusiness size={15} className="mr-1 inline" />Служебный кабинет</Link>}<NotificationCenter token={token} /></div>
    </header>
    {error && <div role="alert" className="m-4 rounded-lg border border-red-300/25 p-4 text-sm text-red-200">{error}</div>}
    {membership ? <ResidentMembershipView membership={membership} quotas={data?.effective_quotas || {}} onChanged={load} /> : <section className="mx-auto mt-10 max-w-xl rounded-xl border border-white/15 p-6 text-center"><h1 className="text-2xl">Участие не найдено</h1><p className="mt-3 text-white/60">Возможно, доступ был изменён. Вернитесь в основной дашборд.</p><Link href="/dashboard" className="workspace-button mt-6">Вернуться</Link></section>}
  </main>;
}
