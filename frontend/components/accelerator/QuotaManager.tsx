"use client";

import { useEffect, useState } from "react";
import { Loader2, UserRoundCog, Users } from "lucide-react";

import { describeApiError, getAuthJson, putAuthJson } from "@/lib/api";

export type Limits = { messages: number; roadmaps: number; custdev: number; grants: number };
type Resident = { membership_id: number; name: string; email: string };
type QuotaResponse = { resources: Partial<Record<keyof Limits, { limit: number; used: number; remaining: number; source: string }>> };

const DEFAULTS: Limits = { messages: 70, roadmaps: 4, custdev: 2, grants: 1 };

export function QuotaManager({ token, cohortId, initialTemplate, residents }: { token: string; cohortId: number; initialTemplate?: Limits | null; residents: Resident[] }) {
  const [template, setTemplate] = useState<Limits>(initialTemplate || DEFAULTS);
  const [selected, setSelected] = useState<Resident | null>(null);
  const [personal, setPersonal] = useState<Limits>(DEFAULTS);
  const [usage, setUsage] = useState<QuotaResponse["resources"]>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { setTemplate(initialTemplate || DEFAULTS); setSelected(null); }, [cohortId, initialTemplate]);

  const openResident = async (resident: Resident, clearFeedback = true) => {
    setSelected(resident); setBusy("load"); setError(""); if (clearFeedback) setNotice("");
    try {
      const row = await getAuthJson<QuotaResponse>(`/api/accelerators/memberships/${resident.membership_id}/quota`, token);
      setUsage(row.resources);
      setPersonal({
        messages: row.resources.messages?.limit ?? template.messages,
        roadmaps: row.resources.roadmaps?.limit ?? template.roadmaps,
        custdev: row.resources.custdev?.limit ?? template.custdev,
        grants: row.resources.grants?.limit ?? template.grants,
      });
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить лимиты резидента")); }
    finally { setBusy(""); }
  };

  const saveTemplate = async () => {
    setBusy("template"); setError(""); setNotice("");
    try {
      const result = await putAuthJson<{ affected: number; skipped_personal: number }>(`/api/accelerators/cohorts/${cohortId}/quota-template`, { limits: template, apply_to_existing: true, overwrite_personal: false }, token);
      setNotice(`Лимиты потока сохранены. Обновлено резидентов: ${result.affected}; персональные настройки сохранены: ${result.skipped_personal}.`);
    } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить лимиты потока")); }
    finally { setBusy(""); }
  };

  const savePersonal = async () => {
    if (!selected) return;
    setBusy("personal"); setError(""); setNotice("");
    try {
      await putAuthJson(`/api/accelerators/memberships/${selected.membership_id}/quota`, { limits: personal, reason: "Индивидуальная настройка администратора" }, token);
      setNotice(`Персональные лимиты для ${selected.name} сохранены.`);
      await openResident(selected, false);
    } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить персональные лимиты")); }
    finally { setBusy(""); }
  };

  return <div className="space-y-6">
    <section className="workspace-card">
      <div className="mb-5 flex items-start gap-3"><Users className="mt-1 text-white/45" /><div><h2 className="text-xl">Общие лимиты потока</h2><p className="mt-1 text-sm text-white/40">Применяются каждому резиденту, у которого нет персонального переопределения.</p></div></div>
      <LimitsEditor value={template} onChange={setTemplate} />
      <button type="button" onClick={() => void saveTemplate()} disabled={Boolean(busy)} className="workspace-button mt-5">{busy === "template" && <Loader2 size={15} className="animate-spin" />} Сохранить для потока</button>
    </section>
    <section className="workspace-card">
      <div className="mb-5 flex items-start gap-3"><UserRoundCog className="mt-1 text-white/45" /><div><h2 className="text-xl">Индивидуальные лимиты</h2><p className="mt-1 text-sm text-white/40">Сначала открываются текущие значения выбранного резидента — лимиты потока сюда не копируются вслепую.</p></div></div>
      {!residents.length ? <p className="text-sm text-white/35">В потоке ещё нет резидентов.</p> : <div className="grid gap-3 sm:grid-cols-2">{residents.map((resident) => <button type="button" key={resident.membership_id} onClick={() => void openResident(resident)} className="rounded-2xl border border-white/10 p-4 text-left hover:border-white/25"><span className="block">{resident.name}</span><span className="mt-1 block text-xs text-white/35">{resident.email}</span></button>)}</div>}
    </section>
    {selected && <section className="workspace-card border-white/20">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl">{selected.name}</h2><p className="text-sm text-white/40">{selected.email}</p></div><button type="button" onClick={() => setSelected(null)} className="text-sm text-white/45">Закрыть</button></div>
      {busy === "load" ? <Loader2 className="animate-spin text-white/40" /> : <><LimitsEditor value={personal} onChange={setPersonal} usage={usage} /><button type="button" onClick={() => void savePersonal()} disabled={Boolean(busy)} className="workspace-button mt-5">{busy === "personal" && <Loader2 size={15} className="animate-spin" />} Сохранить персональные лимиты</button></>}
    </section>}
    {notice && <p className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[.07] p-4 text-sm text-emerald-200">{notice}</p>}
    {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}

function LimitsEditor({ value, onChange, usage }: { value: Limits; onChange: (value: Limits) => void; usage?: QuotaResponse["resources"] }) {
  const items: Array<[keyof Limits, string]> = [["messages", "Сообщения"], ["roadmaps", "Дорожные карты"], ["custdev", "Кастдевы"], ["grants", "Заявки на гранты"]];
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{items.map(([key, label]) => <label key={key} className="text-sm text-white/60">{label}<input type="number" min={-1} value={value[key]} onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })} className="workspace-input mt-2" />{usage?.[key] && <span className="mt-2 block text-xs text-white/35">Использовано: {usage[key]?.used} · источник: {usage[key]?.source === "individual" ? "персональный" : "поток"}</span>}</label>)}</div>;
}
