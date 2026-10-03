"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/hooks/useAuth";
import { LoaderCircle, Plus, RefreshCw } from "lucide-react";

type Campaign = { id: number; name: string; code: string; status: string; starts_at: string | null; ends_at: string | null; settings: Record<string, unknown> };
type Participant = { id: number; email: string; run_id: number; score: number | null; score_version: string | null; reward_status: string; registered_at: string };

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export default function AudienceSimulationAdminPage() {
  const auth = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [participants, setParticipants] = useState<Record<number, Participant[]>>({});
  const [name, setName] = useState("Форум «Цифровые решения»");
  const [code, setCode] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [competition, setCompetition] = useState(false);
  const [minimum, setMinimum] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const request = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(path, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Не удалось выполнить запрос");
    return data as T;
  }, []);

  const load = useCallback(async () => {
    try { setCampaigns(await request<Campaign[]>("/api/audience-simulations/admin/campaigns")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить кампании"); }
  }, [request]);

  useEffect(() => { if (auth.isAuthenticated) void load(); }, [auth.isAuthenticated, load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    const settings = {
      badge: "Форум «Цифровые решения»",
      competition_enabled: competition,
      min_valid_responses: minimum,
      ...(competition ? { score_formula: { version: "40-35-25-v1", weights: { problem_relevance: 40, interest: 35, willingness_to_try: 25 } } } : {}),
    };
    try {
      const created = await request<Campaign>("/api/audience-simulations/admin/campaigns", {
        method: "POST", body: JSON.stringify({ name, code, starts_at: startsAt ? new Date(startsAt).toISOString() : null, ends_at: endsAt ? new Date(endsAt).toISOString() : null, settings }),
      });
      await request(`/api/audience-simulations/admin/campaigns/${created.id}/status?status=active`, { method: "PATCH" });
      setCode(newCode()); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось создать кампанию"); }
    finally { setBusy(false); }
  };

  const loadParticipants = async (campaignId: number) => {
    try {
      const rows = await request<Participant[]>(`/api/audience-simulations/admin/campaigns/${campaignId}/participants`);
      setParticipants((current) => ({ ...current, [campaignId]: rows }));
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить участников"); }
  };

  const rewardAction = async (participant: Participant, action: "winner" | "reward") => {
    setError("");
    try {
      if (action === "winner") {
        await request(`/api/audience-simulations/admin/participants/${participant.id}/winner?selected=${participant.reward_status !== "selected"}`, { method: "PATCH" });
      } else {
        await request(`/api/audience-simulations/admin/participants/${participant.id}/reward`, { method: "POST" });
      }
      const campaign = campaigns.find((item) => participants[item.id]?.some((row) => row.id === participant.id));
      if (campaign) await loadParticipants(campaign.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось обновить выдачу приза"); }
  };

  if (!auth.isLoaded) return <main className="grid min-h-[100dvh] place-items-center bg-[#09090c] text-white"><LoaderCircle className="animate-spin" /></main>;
  if (!auth.isAuthenticated) return <main className="grid min-h-[100dvh] place-items-center bg-[#09090c] px-5 text-white"><div className="text-center"><h1 className="text-3xl">Войдите как администратор Pitchy</h1><Link href={`/login?next=${encodeURIComponent("/audience-simulation/admin")}`} className="mt-6 inline-block rounded-full bg-white px-6 py-3 text-sm text-black">Войти</Link></div></main>;

  return <main className="min-h-[100dvh] bg-[#09090c] px-5 py-9 text-white"><div className="mx-auto max-w-5xl">
    <p className="text-xs uppercase tracking-[.2em] text-sky-200/60">Закрытая панель Pitchy</p><h1 className="mt-3 text-4xl tracking-tight">Кампании симуляции аудитории</h1>
    {error && <p role="alert" className="mt-5 rounded-xl border border-rose-200/20 bg-rose-200/5 p-4 text-sm text-rose-100">{error}</p>}
    <form onSubmit={create} className="mt-8 grid gap-4 rounded-3xl border border-white/10 bg-white/[.025] p-5 sm:grid-cols-2 sm:p-7">
      <h2 className="text-xl sm:col-span-2">Новая форумная кампания</h2>
      <label className="text-sm text-white/65">Название<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-white" /></label>
      <label className="text-sm text-white/65">Закрытый код<input value={code} onChange={(event) => setCode(event.target.value)} required minLength={16} className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 p-3 font-mono text-xs text-white" /><button type="button" onClick={() => setCode(newCode())} className="mt-2 text-xs text-sky-200/60">Создать новый код</button></label>
      <label className="text-sm text-white/65">Начало<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-white" /></label>
      <label className="text-sm text-white/65">Окончание<input type="datetime-local" value={endsAt} min={startsAt || undefined} onChange={(event) => setEndsAt(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-white" /></label>
      <label className="flex items-start gap-3 rounded-2xl border border-white/8 p-4 text-sm leading-5 text-white/65 sm:col-span-2"><input type="checkbox" checked={competition} onChange={(event) => setCompetition(event.target.checked)} className="mt-1 accent-sky-200" /><span><b className="font-medium text-white/80">Включить конкурсный балл</b><span className="mt-1 block text-xs text-white/40">Использовать формулу из спецификации: 40% актуальность проблемы, 35% интерес, 25% готовность попробовать. После активации правила фиксируются.</span></span></label>
      <label className="text-sm text-white/65">Минимум валидных ответов для допуска<input type="number" min={5} max={12} value={minimum} onChange={(event) => setMinimum(Number(event.target.value))} className="mt-2 block w-full rounded-xl border border-white/10 bg-black/25 p-3 text-white" /><span className="mt-1 block text-xs text-white/35">В первой версии исследуется до 12 профилей на запуск.</span></label>
      <button disabled={busy || code.length < 16} className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black disabled:opacity-40 sm:self-end">{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />} Создать и активировать</button>
    </form>
    <div className="mt-10 flex items-center justify-between"><h2 className="text-2xl">Участники</h2><button onClick={() => void load()} className="flex items-center gap-2 text-xs text-white/40 hover:text-white"><RefreshCw size={14} /> Обновить</button></div>
    <div className="mt-4 space-y-4">{campaigns.map((campaign) => <section key={campaign.id} className="rounded-3xl border border-white/10 bg-white/[.025] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg">{campaign.name}</h3><p className="mt-1 text-xs text-white/35">{campaign.status} · {campaign.starts_at ? new Date(campaign.starts_at).toLocaleString("ru-RU") : "без даты начала"}{campaign.ends_at ? ` — ${new Date(campaign.ends_at).toLocaleString("ru-RU")}` : ""}</p><p className="mt-2 text-xs text-white/35">Код: <span className="select-all font-mono">{campaign.code}</span></p></div><div className="flex gap-2"><a href={`/audience-simulation/operator/${encodeURIComponent(campaign.code)}`} target="_blank" rel="noreferrer" className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70">Открыть стенд</a><button onClick={() => void loadParticipants(campaign.id)} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70">Загрузить список</button></div></div>
      {participants[campaign.id] && <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-white/35"><tr><th className="py-2">Участник</th><th>Балл</th><th>Прогон</th><th>Подписка</th><th>Действие</th><th>Регистрация</th></tr></thead><tbody>{participants[campaign.id].map((participant) => <tr key={participant.id} className="border-t border-white/8 text-white/65"><td className="py-3">{participant.email}</td><td>{participant.score == null ? "Недопущен" : `${participant.score} / 100`}</td><td>#{participant.run_id}</td><td>{participant.reward_status}</td><td className="py-2">{participant.reward_status === "issued" ? "Выдано: 1 мес. + 3 CustDev" : <div className="flex flex-wrap gap-2">{participant.reward_status === "selected" ? <><button onClick={() => void rewardAction(participant, "winner")} className="rounded-full border border-white/15 px-3 py-1.5">Снять выбор</button><button onClick={() => void rewardAction(participant, "reward")} className="rounded-full bg-white px-3 py-1.5 text-black">Выдать приз</button></> : <button onClick={() => void rewardAction(participant, "winner")} className="rounded-full border border-white/15 px-3 py-1.5">Выбрать победителем</button>}</div>}</td><td>{new Date(participant.registered_at).toLocaleString("ru-RU")}</td></tr>)}</tbody></table><p className="mt-3 text-xs text-white/35">Приз: базовая подписка на 30 дней и ещё 3 кастдева (итого 5 за период). Выдача не заменяет существующую подписку.</p></div>}
    </section>)}</div>
  </div></main>;
}
