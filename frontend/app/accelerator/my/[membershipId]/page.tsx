"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BriefcaseBusiness, Loader2, Menu, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { describeApiError, getAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { getAcceleratorMemberships } from "@/lib/acceleratorMemberships";
import { takeAcceleratorEntry } from "@/lib/acceleratorEntryHandoff";
import { NotificationCenter } from "@/components/accelerator/NotificationCenter";
import { AcceleratorThemeToggle } from "@/components/accelerator/AcceleratorTheme";
import { PitchyLogo } from "@/components/shared/PitchyLogo";
import { ResidentMembershipView, type ResidentWorkspaceData } from "@/components/accelerator/ResidentWorkspace";
import { participantMemberships, staffAccelerators, type AcceleratorAccess } from "@/lib/acceleratorAccess";

export default function ResidentAcceleratorPage() {
  const router = useRouter();
  const { membershipId } = useParams<{ membershipId: string }>();
  const { token, isLoaded } = useAuth();
  const [data, setData] = useState<ResidentWorkspaceData | null>(null);
  const [accelerators, setAccelerators] = useState<AcceleratorAccess[]>([]);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const numericMembershipId = Number(membershipId);
  const hasValidMembershipId = Number.isInteger(numericMembershipId) && numericMembershipId > 0;
  const initialLoad = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !hasValidMembershipId) return;
    try {
      const entry = takeAcceleratorEntry(token);
      if (entry) {
        setData(entry.workspace);
        setAccelerators(entry.access);
        setError("");
        return;
      }
      // Staff navigation is optional and must not hold up the participant's first screen.
      void getAuthJson<AcceleratorAccess[]>("/api/accelerators", token).then(setAccelerators).catch(() => {});
      const workspace = await getAcceleratorMemberships(token);
      setData(workspace);
      setError("");
    }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить кабинет участника")); }
    finally { setLoading(false); }
  }, [hasValidMembershipId, token]);

  useEffect(() => {
    if (!token) { initialLoad.current = null; return; }
    const key = `${token}:${numericMembershipId}`;
    if (initialLoad.current === key) return;
    initialLoad.current = key;
    void load();
  }, [load, numericMembershipId, token]);
  const membership = data?.memberships.find((row) => row.membership_id === numericMembershipId) || null;
  const memberships = participantMemberships(data?.memberships || []);
  const serviceAccelerator = staffAccelerators(accelerators).find((row) => row.id === membership?.accelerator.id) || staffAccelerators(accelerators)[0] || null;

  if (!isLoaded || (loading && hasValidMembershipId && token)) return <main className="grid min-h-[100dvh] place-items-center bg-black text-white"><Loader2 className="animate-spin text-white/35" /></main>;
  if (!token) return <main className="grid min-h-[100dvh] place-items-center bg-black px-5 text-white"><section className="text-center"><h1 className="text-3xl">Нужно войти</h1><Link href={`/login?next=/accelerator/my/${numericMembershipId}`} className="workspace-button mt-6">Войти</Link></section></main>;

  const switchMembership = (id: string) => {
    setMobileMenu(false);
    router.push(`/accelerator/my/${id}`);
  };
  const staffHref = serviceAccelerator ? `/accelerator?context=staff&accelerator=${serviceAccelerator.id}` : null;
  const cohortSelector = (className: string) => memberships.length > 1
    ? <select aria-label="Поток" value={numericMembershipId} onChange={event => switchMembership(event.target.value)} className={className}>
      {memberships.map(row => <option key={row.membership_id} value={row.membership_id}>{row.cohort.name}</option>)}
    </select>
    : <span className={className} title={membership?.cohort.name}>{membership?.cohort.name || "Поток"}</span>;

  return <main className="min-h-[100dvh] bg-[#141313] text-[#e5e2e1]">
    <header className="flex min-h-14 items-center justify-between gap-2 border-b border-white/15 px-4 py-2 lg:min-h-[76px] lg:gap-4 lg:px-8 lg:py-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
        {membership && <button type="button" aria-expanded={mobileMenu} aria-controls="resident-mobile-navigation"
          aria-label="Меню участника" onClick={() => setMobileMenu(open => !open)}
          className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-white/10">
          {mobileMenu ? <X size={20} /> : <Menu size={20} />}
        </button>}
        {cohortSelector(`min-w-0 flex-1 truncate rounded-lg py-2 text-sm font-medium ${memberships.length > 1 ? "border border-white/15 bg-[#141313] px-2" : ""}`)}
      </div>
      <div className="hidden min-w-0 items-center gap-4 lg:flex">
        <Link href="/dashboard" aria-label="В Pitchy"><PitchyLogo size="2xl" /></Link>
        <span className="text-white/25">│</span><span className="text-sm">Акселератор</span>
        {memberships.length > 1 && cohortSelector("max-w-48 truncate rounded-lg border border-white/15 bg-[#141313] px-3 py-2 text-sm text-white/75")}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="hidden items-center gap-3 lg:flex">
          <Link href="/dashboard" className="rounded-lg border border-white/20 px-3 py-2 text-sm">Дашборд</Link>
          {staffHref && <Link href={staffHref} className="rounded-lg border border-white/20 px-3 py-2 text-sm"><BriefcaseBusiness size={15} className="mr-1 inline" />Служебный кабинет</Link>}
        </div>
        <NotificationCenter token={token} cohortId={membership?.cohort.id} context="resident" />
        <div className="hidden lg:block"><AcceleratorThemeToggle /></div>
      </div>
    </header>
    {error && <div role="alert" className="m-4 rounded-lg border border-red-300/25 p-4 text-sm text-red-200">{error}</div>}
    {membership ? <ResidentMembershipView membership={membership} quotas={data?.effective_quotas || {}} onChanged={load}
      mobileNavigation={{
        open: mobileMenu,
        onClose: () => setMobileMenu(false),
        footer: <div className="mt-3 flex flex-col gap-1 border-t border-white/15 pt-3 text-sm">
          <Link href="/dashboard" className="rounded-lg px-3 py-3">Дашборд Pitchy</Link>
          {staffHref && <Link href={staffHref} className="rounded-lg px-3 py-3">Служебный кабинет</Link>}
          <div className="flex items-center justify-between px-3 py-1"><span>Тема оформления</span><AcceleratorThemeToggle /></div>
        </div>,
      }} /> : <section className="mx-auto mt-10 max-w-xl rounded-xl border border-white/15 p-6 text-center"><h1 className="text-2xl">Участие не найдено</h1><p className="mt-3 text-white/60">Возможно, доступ был изменён. Вернитесь в основной дашборд.</p><Link href="/dashboard" className="workspace-button mt-6">Вернуться</Link></section>}
  </main>;
}
