"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import { getAuthJson } from "@/lib/api";
import { ParticipantProfileForm, type ParticipantFields } from "./ParticipantProfile";

type Pending = { membership_id: number; registration_required?: boolean; participant_profile?: ParticipantFields; cohort: { name: string } };
export function ParticipantRegistrationGate() {
  const { token } = useAuth(); const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    try { const data = await getAuthJson<{ memberships: Pending[] }>("/api/accelerators/me/memberships", token); setPending(data.memberships.find(m => m.registration_required) || null); }
    catch { /* Auth errors are handled by the current page. */ }
  }, [token]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, pathname]);
  const show = !!token && !!pending && pathname !== "/set-password";
  useEffect(() => {
    const dialog = dialogRef.current;
    if (show && dialog && !dialog.open) dialog.showModal();
  }, [show]);
  if (!show || !pending || !token) return null;
  return <dialog ref={dialogRef} onCancel={event => event.preventDefault()} className="fixed inset-0 m-0 h-screen max-h-none w-screen max-w-none overflow-y-auto bg-black/95 p-5 text-white backdrop:bg-black/95" aria-label="Завершение регистрации"><div className="mx-auto my-10 max-w-2xl"><p className="mb-4">{pending.cohort.name}</p><ParticipantProfileForm key={pending.membership_id} membershipId={pending.membership_id} profile={pending.participant_profile || {}} token={token} required onSaved={load} /></div></dialog>;
}
