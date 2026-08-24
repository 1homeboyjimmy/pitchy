"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, ChevronDown, Loader2, Mail, RefreshCw, X } from "lucide-react";

import { ApiError, describeApiError, getAuthJson, patchAuthJson, postAuthJson } from "@/lib/api";

type NotificationItem = {
  id: number;
  event_type: string;
  title: string;
  body: string;
  action_url?: string | null;
  read_at?: string | null;
  created_at: string;
};

type NotificationPage = { items: NotificationItem[]; next_cursor?: number | null };
type NotificationPreferences = { email_enabled: boolean };

const POLL_INTERVAL_MS = 45_000;

export function NotificationCenter({ token }: { token: string }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const authFailedRef = useRef(false);
  const countInFlightRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const handleError = useCallback((reason: unknown, fallback: string) => {
    if (reason instanceof ApiError && reason.status === 401) {
      authFailedRef.current = true;
      return;
    }
    setError(describeApiError(reason, fallback));
  }, []);

  const loadUnreadCount = useCallback(async () => {
    if (authFailedRef.current || countInFlightRef.current) return;
    countInFlightRef.current = true;
    try {
      const response = await getAuthJson<{ count: number }>("/api/accelerators/notifications/unread-count", token);
      setUnreadCount(Math.max(0, response.count));
    } catch (reason) {
      handleError(reason, "Не удалось обновить счётчик уведомлений");
    } finally {
      countInFlightRef.current = false;
    }
  }, [handleError, token]);

  const loadNotifications = useCallback(async (cursor?: number) => {
    if (authFailedRef.current) return;
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const response = await getAuthJson<NotificationPage>(`/api/accelerators/notifications?unread_only=false&limit=30${suffix}`, token);
      setItems((current) => cursor
        ? [...current, ...response.items.filter((item) => !current.some((currentItem) => currentItem.id === item.id))]
        : response.items);
      setNextCursor(response.next_cursor ?? null);
    } catch (reason) {
      handleError(reason, "Не удалось загрузить уведомления");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [handleError, token]);

  const loadPreferences = useCallback(async () => {
    if (authFailedRef.current) return;
    try {
      setPreferences(await getAuthJson<NotificationPreferences>("/api/accelerators/notifications/preferences", token));
    } catch (reason) {
      handleError(reason, "Не удалось загрузить настройки уведомлений");
    }
  }, [handleError, token]);

  useEffect(() => {
    authFailedRef.current = false;
    void loadUnreadCount();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadUnreadCount();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loadUnreadCount, token]);

  useEffect(() => {
    if (!open) return;
    void Promise.all([loadNotifications(), loadPreferences()]);
  }, [loadNotifications, loadPreferences, open]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() => panelRef.current?.focus());
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const markRead = async (item: NotificationItem) => {
    if (item.read_at || authFailedRef.current) return;
    setBusy(`read-${item.id}`);
    setError("");
    try {
      await patchAuthJson(`/api/accelerators/notifications/${item.id}/read`, {}, token);
      const readAt = new Date().toISOString();
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, read_at: readAt } : row));
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch (reason) {
      handleError(reason, "Не удалось отметить уведомление");
    } finally {
      setBusy("");
    }
  };

  const markAllRead = async () => {
    if (!unreadCount || authFailedRef.current) return;
    setBusy("read-all");
    setError("");
    try {
      await postAuthJson("/api/accelerators/notifications/read-all", {}, token);
      const readAt = new Date().toISOString();
      setItems((current) => current.map((row) => row.read_at ? row : { ...row, read_at: readAt }));
      setUnreadCount(0);
    } catch (reason) {
      handleError(reason, "Не удалось отметить все уведомления");
    } finally {
      setBusy("");
    }
  };

  const updateEmailPreference = async (enabled: boolean) => {
    if (authFailedRef.current) return;
    const previous = preferences;
    setPreferences({ email_enabled: enabled });
    setBusy("preferences");
    setError("");
    try {
      setPreferences(await patchAuthJson<NotificationPreferences>("/api/accelerators/notifications/preferences", { email_enabled: enabled }, token));
    } catch (reason) {
      setPreferences(previous);
      handleError(reason, "Не удалось сохранить настройку email");
    } finally {
      setBusy("");
    }
  };

  const openNotification = async (item: NotificationItem, path: string) => {
    await markRead(item);
    if (authFailedRef.current) return;
    setOpen(false);
    router.push(path);
  };

  const visibleCount = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-full border border-white/10 p-3 text-white/55 hover:border-white/25 hover:text-white"
        aria-label={unreadCount ? `Уведомления, непрочитанных: ${unreadCount}` : "Уведомления"}
        aria-haspopup="dialog"
        aria-controls="accelerator-notifications"
        aria-expanded={open}
      >
        <Bell size={17} />
        {unreadCount > 0 && <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white ring-2 ring-black">{visibleCount}</span>}
      </button>

      {open && <section ref={panelRef} id="accelerator-notifications" role="dialog" aria-modal="false" aria-labelledby="accelerator-notifications-title" tabIndex={-1} className="fixed inset-x-4 top-24 z-50 max-h-[calc(100dvh-7rem)] overflow-hidden rounded-3xl border border-white/12 bg-[#0b0b0b] shadow-2xl shadow-black/60 outline-none sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+0.75rem)] sm:w-[430px]">
        <div className="flex items-start justify-between gap-4 border-b border-white/8 p-4 sm:p-5">
          <div><h2 id="accelerator-notifications-title" className="text-lg">Уведомления</h2><p className="mt-1 text-xs text-white/35">{unreadCount ? `${unreadCount} непрочитанных` : "Всё прочитано"}</p></div>
          <div className="flex gap-1">
            <button type="button" onClick={() => void loadNotifications()} disabled={loading || Boolean(busy)} className="rounded-full p-2 text-white/35 hover:bg-white/[0.06] hover:text-white" aria-label="Обновить уведомления"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>
            <button type="button" onClick={() => { setOpen(false); triggerRef.current?.focus(); }} className="rounded-full p-2 text-white/35 hover:bg-white/[0.06] hover:text-white" aria-label="Закрыть уведомления"><X size={17} /></button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3 sm:px-5">
          <label className="flex items-center gap-2 text-xs text-white/50"><Mail size={14} /><input type="checkbox" checked={Boolean(preferences?.email_enabled)} disabled={!preferences || busy === "preferences"} onChange={(event) => void updateEmailPreference(event.target.checked)} className="accent-white" /> Дублировать на email</label>
          <button type="button" onClick={() => void markAllRead()} disabled={!unreadCount || Boolean(busy)} className="inline-flex items-center gap-1.5 text-xs text-white/45 hover:text-white disabled:opacity-35">{busy === "read-all" ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={14} />} Прочитать все</button>
        </div>

        <div className="max-h-[min(60dvh,540px)] overflow-y-auto" aria-live="polite">
          {loading && !items.length ? <div className="grid min-h-44 place-items-center"><Loader2 className="animate-spin text-white/35" /></div> : !items.length ? <div className="px-6 py-12 text-center"><Bell className="mx-auto mb-4 text-white/20" size={30} /><h3>Пока тихо</h3><p className="mt-2 text-sm text-white/35">Здесь появятся важные события акселератора.</p></div> : <ul className="divide-y divide-white/[0.06]">{items.map((item) => {
            const safePath = safeInternalPath(item.action_url);
            const unread = !item.read_at;
            return <li key={item.id} className={`p-4 sm:px-5 ${unread ? "bg-white/[0.035]" : ""}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${unread ? "bg-blue-400" : "bg-white/15"}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3"><h3 className={`text-sm ${unread ? "text-white" : "text-white/60"}`}>{item.title}</h3><time dateTime={item.created_at} className="shrink-0 text-[11px] text-white/25">{formatNotificationDate(item.created_at)}</time></div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-5 text-white/40">{item.body}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {safePath && <button type="button" onClick={() => void openNotification(item, safePath)} disabled={Boolean(busy)} className="text-xs text-blue-300 hover:text-blue-200">Открыть</button>}
                    {unread && <button type="button" onClick={() => void markRead(item)} disabled={Boolean(busy)} className="inline-flex items-center gap-1 text-xs text-white/35 hover:text-white">{busy === `read-${item.id}` ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Отметить прочитанным</button>}
                  </div>
                </div>
              </div>
            </li>;
          })}</ul>}
          {nextCursor && <div className="border-t border-white/8 p-3 text-center"><button type="button" onClick={() => void loadNotifications(nextCursor)} disabled={loadingMore || Boolean(busy)} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs text-white/45 hover:bg-white/[0.05] hover:text-white">{loadingMore ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} />} Показать ещё</button></div>}
        </div>
        {error && <p role="alert" className="border-t border-red-400/15 bg-red-400/[0.06] px-4 py-3 text-xs text-red-200">{error}</p>}
      </section>}
    </div>
  );
}

export function safeInternalPath(value?: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001F]/.test(value)) return null;
  try {
    const internalOrigin = "https://pitchy.internal";
    const parsed = new URL(value, internalOrigin);
    if (parsed.origin !== internalOrigin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function formatNotificationDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat("ru-RU", sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short" }).format(date);
}
