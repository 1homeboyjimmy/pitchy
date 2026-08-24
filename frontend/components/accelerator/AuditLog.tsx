"use client";

import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";

import { describeApiError, getAuthJson } from "@/lib/api";

type AuditRow = { id: number; actor_user_id?: number | null; action: string; target_type?: string | null; target_id?: number | null; details?: Record<string, unknown> | null; created_at: string };
const LABELS: Record<string, string> = {
  "accelerator.created": "Создан акселератор", "accelerator.setup_completed": "Завершена первичная настройка", "accelerator.updated": "Изменены настройки акселератора",
  "cohort.created": "Создан поток", "cohort.updated": "Изменены настройки потока", "cohort.status_changed": "Изменён статус потока", "program_config.updated": "Изменён набор модулей",
  "organizer.assigned": "Назначен организатор", "organizer.removed": "Удалён организатор", "application.accepted": "Одобрена заявка", "application.enrolled": "Зачислен резидент",
  "cohort_quota.assigned": "Обновлены лимиты потока", "resident_quota.assigned": "Обновлены лимиты резидента", "program_stage.created": "Создан этап программы", "program_stage.published": "Опубликован этап программы",
  "homework.created": "Создано домашнее задание", "homework.published": "Опубликовано домашнее задание", "event.created": "Создано мероприятие", "event.published": "Опубликовано мероприятие",
  "project_audit.requested": "Запрошен аудит проекта", "project_audit.completed": "Завершён аудит проекта", "project_audit.failed": "Аудит проекта завершился ошибкой", "project_audit.task_created": "Создана задача по результату аудита",
  "demo_day.created": "Создан демо-день", "demo_day.project_selected": "Проект отобран на демо-день", "demo_day.project_removed": "Проект снят с демо-дня", "demo_day.expert_assigned": "Эксперт приглашён в жюри", "demo_day.expert_removed": "Эксперт удалён из жюри", "demo_day.materials_submitted": "Отправлены материалы демо-дня", "demo_day.score_submitted": "Эксперт оценил проект", "demo_day.decision_updated": "Обновлено решение жюри", "demo_day.status_changed": "Изменён этап демо-дня",
};

export function AuditLog({ token, acceleratorId }: { token: string; acceleratorId: number }) {
  const [rows, setRows] = useState<AuditRow[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { void Promise.resolve().then(() => { setLoading(true); setError(""); return getAuthJson<AuditRow[]>(`/api/accelerators/${acceleratorId}/audit?limit=200`, token); }).then(setRows).catch((reason) => setError(describeApiError(reason, "Не удалось загрузить журнал"))).finally(() => setLoading(false)); }, [acceleratorId, token]);
  return <section className="workspace-card"><div className="mb-6 flex items-start gap-3"><History className="mt-1 text-white/45" /><div><h2 className="text-xl">Журнал изменений</h2><p className="mt-1 text-sm text-white/40">Кто и когда менял программу, заявки, лимиты и команду.</p></div></div>{loading ? <Loader2 className="animate-spin text-white/35" /> : error ? <p role="alert" className="text-sm text-red-200">{error}</p> : !rows.length ? <p className="text-sm text-white/35">Изменений пока нет.</p> : <div className="space-y-1">{rows.map((row) => <article key={row.id} className="grid gap-1 border-b border-white/[.06] py-3 sm:grid-cols-[170px_1fr_auto]"><time className="text-xs text-white/30">{new Date(row.created_at).toLocaleString("ru-RU")}</time><div><p className="text-sm text-white/70">{LABELS[row.action] || row.action}</p>{row.details && <details className="mt-1 text-xs text-white/30"><summary className="cursor-pointer">Подробности</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify(row.details, null, 2)}</pre></details>}</div><span className="text-xs text-white/25">пользователь #{row.actor_user_id || "—"}</span></article>)}</div>}</section>;
}
