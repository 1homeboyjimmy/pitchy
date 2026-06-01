"use client";

import { useState, useRef, useEffect } from "react";
import { FolderInput, FolderCheck, Loader, Check } from "lucide-react";
import { getProjects, attachSessionToProject, type ProjectListItem } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/ui";

interface Props {
  token: string;
  sessionId: number;
  projectId?: number | null;
  onAttached: (sessionId: number, projectId: number) => void;
}

export function SessionFolderMenu({ token, sessionId, projectId, onAttached }: Props) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const next = !open;
    setOpen(next);
    if (next && projects === null) {
      setLoading(true);
      try {
        setProjects(await getProjects(token));
      } catch (err) {
        console.error(err);
        notifyError("Не удалось загрузить папки");
      } finally {
        setLoading(false);
      }
    }
  };

  const attach = async (e: React.MouseEvent, pid: number) => {
    e.stopPropagation();
    e.preventDefault();
    setBusy(true);
    try {
      await attachSessionToProject(pid, sessionId, token);
      onAttached(sessionId, pid);
      notifySuccess("Чат добавлен в папку");
      setOpen(false);
    } catch (err) {
      console.error(err);
      notifyError("Не удалось переместить чат");
    } finally {
      setBusy(false);
    }
  };

  const attached = projectId != null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        title={attached ? "В папке" : "Добавить в папку"}
        className={`w-9 h-9 flex items-center justify-center rounded-xl border transition-all ${
          attached
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
            : "bg-white/[0.03] border-white/5 text-white/40 hover:bg-white/10 hover:text-white"
        }`}
      >
        {attached ? <FolderCheck className="w-4 h-4" strokeWidth={1.8} /> : <FolderInput className="w-4 h-4" strokeWidth={1.8} />}
      </button>

      {open && (
        <div
          className="absolute right-0 top-11 z-50 w-60 bg-neutral-950 border border-white/10 rounded-2xl p-2 shadow-2xl"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        >
          <div className="px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">Переместить в папку</div>
          {loading ? (
            <div className="flex justify-center py-4"><Loader className="animate-spin text-white/30" size={16} /></div>
          ) : projects && projects.length > 0 ? (
            <div className="max-h-56 overflow-y-auto">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={(e) => attach(e, p.id)}
                  disabled={busy}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-sm text-white/70 hover:bg-white/5 hover:text-white transition-all disabled:opacity-40"
                >
                  <span className="truncate">{p.name}</span>
                  {projectId === p.id && <Check size={14} className="text-emerald-400 shrink-0" />}
                </button>
              ))}
            </div>
          ) : (
            <div className="px-2.5 py-3 text-white/40 text-xs">Сначала создайте папку проекта выше.</div>
          )}
        </div>
      )}
    </div>
  );
}
