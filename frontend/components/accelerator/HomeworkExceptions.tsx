"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { describeApiError, getAuthJson, postAuthJson, putAuthJson } from "@/lib/api";

type Resident = { membership_id: number; name: string };
type Rule = { membership_id: number; allow_individual: boolean; due_at: string | null; reason: string };
type Credit = { attempt_id: number; attempt_number: number; context: { team_name?: string | null; project_name?: string | null; members?: Array<{ name: string }> } };
export function HomeworkExceptions({ assignment, token, residents, onClose, onSaved }: {
  assignment: { id: number; title: string }; token: string; residents: Resident[]; onClose: () => void; onSaved: () => void;
}) {
  const [rules, setRules] = useState<Rule[]>([]); const [credits, setCredits] = useState<Credit[]>([]);
  const [memberId, setMemberId] = useState(""); const [allowIndividual, setAllowIndividual] = useState(false);
  const [dueAt, setDueAt] = useState(""); const [reason, setReason] = useState(""); const [attemptId, setAttemptId] = useState("");
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; Promise.all([
    getAuthJson<Rule[]>(`/api/accelerators/homework/${assignment.id}/exceptions`, token),
    getAuthJson<Credit[]>(`/api/accelerators/homework/${assignment.id}/credit-options`, token),
  ]).then(([rows, versions]) => { if (active) { setRules(rows); setCredits(versions); } }).catch((e) => { if (active) setError(describeApiError(e, "Не удалось загрузить условия")); }); return () => { active = false; }; }, [assignment.id, token]);
  const selectMember = (id: string) => { setMemberId(id); const rule = rules.find((r) => r.membership_id === Number(id)); setAllowIndividual(Boolean(rule?.allow_individual)); setReason(rule?.reason || ""); const d = rule?.due_at ? new Date(rule.due_at) : null; setDueAt(d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""); setMessage(""); };
  const save = async (credit: boolean) => {
    setBusy(true); setError(""); setMessage(""); try {
      if (credit) await postAuthJson(`/api/accelerators/homework/${assignment.id}/credits/${memberId}`, { attempt_id: Number(attemptId), reason }, token);
      else { const saved = await putAuthJson<Rule>(`/api/accelerators/homework/${assignment.id}/exceptions/${memberId}`, { allow_individual: allowIndividual, due_at: dueAt ? new Date(dueAt).toISOString() : null, reason }, token); setRules((rows) => [...rows.filter((r) => r.membership_id !== saved.membership_id), saved]); }
      setMessage(credit ? "Выбранная версия работы зачтена участнику" : "Индивидуальные условия сохранены"); onSaved();
    } catch (e) { setError(describeApiError(e, "Не удалось сохранить изменение")); } finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby="homework-exceptions-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-[#1c1b1b] p-5"><header className="flex justify-between gap-3"><div><h2 id="homework-exceptions-title" className="text-xl">Индивидуальные условия и зачёт</h2><p className="mt-2 text-sm text-white/45">{assignment.title}</p></div><button type="button" onClick={onClose} aria-label="Закрыть условия"><X /></button></header>
    <label className="mt-5 block text-sm text-white/60">Участник<select aria-label="Участник для индивидуальных условий" value={memberId} onChange={(e) => selectMember(e.target.value)} className="workspace-input mt-2"><option value="">Выберите участника</option>{residents.map((r) => <option key={r.membership_id} value={r.membership_id}>{r.name}</option>)}</select></label>
    <label className="mt-4 flex gap-2 text-sm text-white/60"><input type="checkbox" checked={allowIndividual} onChange={(e) => setAllowIndividual(e.target.checked)} /> Разрешить отдельную сдачу независимо от команды и минимума исполнителей</label>
    <label className="mt-4 block text-sm text-white/60">Личный срок сдачи<input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="workspace-input mt-2" /><span className="text-xs text-white/35">Без даты действует общий срок задания.</span></label>
    <label className="mt-4 block text-sm text-white/60">Причина или индивидуальный вариант задания<textarea aria-label="Причина изменения условий" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={2000} rows={3} className="workspace-input mt-2" /></label>
    <button type="button" onClick={() => void save(false)} disabled={busy || !memberId || reason.trim().length < 3} className="workspace-button mt-3">Сохранить условия</button>
    <div className="mt-6 border-t border-white/10 pt-4"><p className="text-sm text-white/60">Засчитать существующую принятую работу</p><p className="mt-1 text-xs text-white/35">Зачёт относится к выбранной версии. Состав её первоначальных исполнителей сохранится.</p><select aria-label="Принятая версия для зачёта" value={attemptId} onChange={(e) => setAttemptId(e.target.value)} className="workspace-input mt-3"><option value="">Выберите принятую версию</option>{credits.map((c) => <option key={c.attempt_id} value={c.attempt_id}>{c.context.team_name || c.context.project_name || c.context.members?.map((m) => m.name).join(", ")} · версия {c.attempt_number} · #{c.attempt_id}</option>)}</select><button type="button" onClick={() => void save(true)} disabled={busy || !memberId || !attemptId || reason.trim().length < 3} className="overview-secondary mt-3">Засчитать участнику</button></div>
    {error && <p role="alert" className="mt-4 text-sm text-red-200">{error}</p>}{message && <p role="status" className="mt-4 text-sm text-emerald-200">{message}</p>}
  </section></div>;
}
