"use client";
import { useEffect, useState } from "react";
import { describeApiError, getAuthJson, putAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";

export function ProjectSelection({ membershipId, onChanged }: { membershipId: number; onChanged: () => Promise<void> }) {
  const { token } = useAuth();
  const [projects, setProjects] = useState<Array<{ id: number; name: string }>>([]);
  const [selected, setSelected] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    getAuthJson<{ project_id: number | null; projects: Array<{ id: number; name: string }> }>(`/api/accelerators/memberships/${membershipId}/project-options`, token)
      .then(data => { if (!cancelled) { setProjects(data.projects); setSelected(String(data.project_id ?? data.projects[0]?.id ?? "")); setSaved(String(data.project_id)); } })
      .catch(() => { if (!cancelled) setProjects([]); });
    return () => { cancelled = true; };
  }, [membershipId, token]);
  if (projects.length < 2) return null;
  const save = async () => {
    if (!token) return;
    setBusy(true); setError("");
    try {
      await putAuthJson(`/api/accelerators/memberships/${membershipId}/project`, { project_id: Number(selected) }, token);
      setSaved(selected); await onChanged();
    } catch (reason) { setError(describeApiError(reason, "Не удалось выбрать проект")); }
    finally { setBusy(false); }
  };
  return <div className="mt-5 border-t border-white/10 pt-4">
    <label className="text-sm text-white/60">Основной проект в акселераторе
      <select className="workspace-input mt-2 !bg-[#1c1b1b] !text-white" style={{ colorScheme: "dark" }} value={selected} onChange={event => setSelected(event.target.value)} disabled={busy}>
        {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </label>
    <p className="mt-2 text-xs text-white/40">Можно изменить выбор позже. Паспорта и история остальных проектов сохранятся.</p>
    <button type="button" className="workspace-button mt-3" disabled={busy || saved === selected} onClick={() => void save()}>Выбрать проект</button>
    {error && <p role="alert" className="mt-2 text-sm text-red-200">{error}</p>}
  </div>;
}
