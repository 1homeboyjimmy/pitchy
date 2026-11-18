"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AuditResultView, type AuditRow } from "@/components/accelerator/ProjectAuditWorkspace";
import { describeApiError, getAuthJson, postAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";

type Report = AuditRow & { can_discuss: boolean };
type Turn = { question: string; answer: string };

export default function ProjectAuditPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    let active = true;
    setReport(null);
    setError("");
    getAuthJson<Report>(`/api/accelerators/project-audits/${auditId}`, token)
      .then(data => { if (active) setReport(data); })
      .catch(reason => { if (active) setError(describeApiError(reason, "Не удалось загрузить отчёт")); });
    return () => { active = false; };
  }, [auditId, token]);

  return <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-8">
    <nav className="mb-5 flex gap-4 text-sm">
      <button type="button" onClick={() => router.back()} className="underline">Назад</button>
      <Link href="/accelerator" className="underline">Акселератор</Link>
    </nav>
    <h1 className="text-3xl font-semibold">Отчёт аудита проекта</h1>
    {error && <p role="alert" className="mt-5 text-red-200">{error}</p>}
    {!token && <Link href={`/login?next=/accelerator/project-audits/${auditId}`} className="mt-5 inline-block underline">Войти в Pitchy</Link>}
    {token && !report && !error && <p role="status" className="mt-5">Загружаем отчёт…</p>}
    {report && <div className="mt-6 grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section className="workspace-card min-w-0">
        <h2 className="text-xl">{report.project?.name || "Проект"}</h2>
        {report.focus && <p className="mt-2 text-sm text-white/60">Фокус аудита · {report.focus}</p>}
        <AuditResultView audit={report} canCreateTasks={false} busy="" />
      </section>
      {report.status === "completed" && report.can_discuss && token && <AuditChat key={report.id} auditId={report.id} token={token} />}
    </div>}
  </main>;
}

function AuditChat({ auditId, token }: { auditId: number; token: string }) {
  const [history, setHistory] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const { answer } = await postAuthJson<{ answer: string }>(
        `/api/accelerators/project-audits/${auditId}/chat`,
        { question: text, history: history.slice(-4) },
        token,
      );
      setHistory(turns => [...turns, { question: text, answer }]);
      setQuestion("");
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось получить ответ"));
    } finally {
      setBusy(false);
    }
  };

  return <section className="workspace-card min-w-0">
    <h2 className="text-xl">Обсудить отчёт с ИИ</h2>
    <div aria-live="polite" className="mt-4 space-y-4">
      {history.map((turn, index) => <div key={index} className="space-y-2 break-words">
        <p className="rounded-xl bg-white/8 p-3 text-sm">{turn.question}</p>
        <p className="whitespace-pre-wrap px-3 text-sm text-white/75">{turn.answer}</p>
      </div>)}
      {busy && <p role="status" className="text-sm text-white/55">ИИ готовит ответ…</p>}
    </div>
    <form onSubmit={send} className="mt-4 space-y-3">
      <label className="block text-sm">
        Вопрос по отчёту
        <textarea value={question} onChange={event => setQuestion(event.target.value)} maxLength={2000}
          rows={3} disabled={busy} className="workspace-input mt-2 resize-y" />
      </label>
      {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
      <button type="submit" disabled={busy || !question.trim()} className="workspace-button">Отправить</button>
    </form>
  </section>;
}
