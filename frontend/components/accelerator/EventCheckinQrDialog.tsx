"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { RefreshCw, X } from "lucide-react";
import { describeApiError, getAuthJson } from "@/lib/api";

type Session = { checkin_url: string; expires_at: string; qr_svg: string };

export function EventCheckinQrDialog({ eventId, token, onClose, onCopy }: { eventId: number; token: string; onClose: () => void; onCopy: (url: string) => Promise<void> }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const row = await getAuthJson<Session>(`/api/accelerators/events/${eventId}/check-in-session`, token);
        if (cancelled) return;
        if (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) throw new Error("QR-код устарел. Обновите его.");
        setSession(row); setError("");
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(() => setSession(null), Math.max(0, Date.parse(row.expires_at) - Date.now()));
        timer = setTimeout(() => { void load(); }, Math.max(1000, Date.parse(row.expires_at) - Date.now() - 30000));
      } catch (reason) {
        if (cancelled) return;
        setSession(null); setError(describeApiError(reason, "Не удалось обновить QR-код"));
        timer = setTimeout(() => { void load(); }, 10000);
      }
    };
    void load();
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(expiryTimer); };
  }, [eventId, token, refresh]);
  return <div className="fixed inset-0 z-[95] grid place-items-center bg-black/75 p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div role="dialog" aria-modal="true" aria-labelledby="qr-title" className="w-full max-w-md rounded-2xl border border-white/15 bg-[#172029] p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 id="qr-title" className="text-2xl">QR-код и ссылка</h2><button autoFocus type="button" aria-label="Закрыть QR-код" onClick={onClose}><X /></button></div>
    {session ? <><div className="mx-auto mt-6 w-fit rounded-2xl bg-white p-4"><Image unoptimized src={`data:image/svg+xml;base64,${btoa(session.qr_svg)}`} alt="QR-код для отметки" width={220} height={220} /></div><p className="mt-4 text-sm text-white/65">QR-код действует 10 минут и обновляется автоматически. Для отметки участник должен войти в свой аккаунт.</p><p className="mt-2 break-all text-xs text-white/55">{session.checkin_url}</p><button type="button" onClick={() => void onCopy(session.checkin_url)} className="overview-secondary mt-4 w-full justify-center">Копировать ссылку</button></> : <p role={error ? "alert" : "status"} className="mt-6 text-sm text-white/70">{error || "Обновляем QR-код…"}</p>}
    <div className="mt-5 flex justify-between gap-3"><button type="button" className="overview-secondary" onClick={() => setRefresh(v => v + 1)}><RefreshCw size={14} /> Обновить QR</button><button type="button" onClick={onClose} className="overview-secondary">Закрыть</button></div>
  </div></div>;
}
