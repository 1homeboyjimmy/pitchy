"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { FolderOpen, FolderPlus, Loader, Gauge, MessageSquare, X, Check, ChevronRight } from "lucide-react";
import { getProjects, createProject, type ProjectListItem, type ChatSessionResponse } from "@/lib/api";
import { notifyError } from "@/lib/ui";
import { PassportModal } from "./PassportModal";
import { FolderModal } from "./FolderModal";

interface Props {
  token: string;
  /** Открыть чат в дашборде (переключить активную сессию + таб). */
  onOpenSession?: (sessionId: number) => void;
  /** Новый чат создан внутри папки — добавить в общий список сессий дашборда. */
  onSessionCreated?: (session: ChatSessionResponse) => void;
  /** Чат привязан к папке — синхронизировать project_id в списке дашборда. */
  onAttached?: (sessionId: number, projectId: number) => void;
  /** Папка удалена — открепить её чаты в списке дашборда (project_id → null). */
  onDeleted?: (projectId: number) => void;
}

export function ProjectFolders({ token, onOpenSession, onSessionCreated, onAttached, onDeleted }: Props) {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [name, setName] = useState("");
  const [editProject, setEditProject] = useState<ProjectListItem | null>(null);
  const [openFolder, setOpenFolder] = useState<ProjectListItem | null>(null);

  useEffect(() => {
    getProjects(token)
      .then(setProjects)
      .catch((e) => { console.error(e); })
      .finally(() => setLoading(false));
  }, [token]);

  const handleCreate = async () => {
    const n = name.trim();
    if (!n) { setShowInput(false); return; }
    setCreating(true);
    try {
      const p = await createProject({ name: n }, token);
      setProjects((prev) => [
        { id: p.id, name: p.name, readiness_index: p.readiness_index, status: p.status, session_count: 0, updated_at: p.updated_at },
        ...prev,
      ]);
      setName("");
      setShowInput(false);
    } catch (e) {
      console.error(e);
      notifyError("Не удалось создать папку проекта");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-4 ml-2">
        <h3 className="font-display text-xl sm:text-2xl text-white/40 flex items-center gap-2">
          <FolderOpen size={20} className="text-white/30" /> Папки проектов
        </h3>
        {!showInput && (
          <button
            onClick={() => setShowInput(true)}
            className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors px-3 py-1.5 rounded-full hover:bg-white/5"
          >
            <FolderPlus size={16} /> Новая папка
          </button>
        )}
      </div>

      {showInput && (
        <div className="lovable-glass rounded-2xl p-4 mb-3 border border-white/10 flex items-center gap-3">
          <FolderPlus size={18} className="text-white/40 shrink-0" />
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setShowInput(false); setName(""); } }}
            placeholder="Название проекта…"
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-white/25"
          />
          <button onClick={handleCreate} disabled={creating}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white text-black hover:bg-neutral-200 transition-all disabled:opacity-40">
            {creating ? <Loader className="animate-spin" size={15} /> : <Check size={16} />}
          </button>
          <button onClick={() => { setShowInput(false); setName(""); }}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 text-white/50 hover:text-white transition-all">
            <X size={16} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader className="animate-spin text-white/20" size={20} /></div>
      ) : projects.length === 0 && !showInput ? (
        <button
          onClick={() => setShowInput(true)}
          className="lovable-glass w-full border border-dashed border-white/10 hover:border-white/25 hover:bg-white/[0.03] transition-all rounded-2xl px-6 py-6 flex items-center gap-4 group"
        >
          <div className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/5 flex items-center justify-center group-hover:bg-white group-hover:text-black transition-colors">
            <FolderPlus size={20} />
          </div>
          <div className="text-left">
            <div className="font-display text-base text-white/90">Создайте папку проекта</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/30 mt-0.5">
              Паспорт, общая память между чатами, подбор грантов
            </div>
          </div>
        </button>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <motion.div
              key={p.id}
              role="button"
              tabIndex={0}
              whileHover={{ y: -2 }}
              onClick={() => setOpenFolder(p)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenFolder(p); } }}
              className="cursor-pointer text-left lovable-glass-strong border border-white/5 hover:border-white/15 rounded-2xl p-5 bg-white/[0.02] transition-all group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center shrink-0">
                    <FolderOpen className="text-white/50" size={20} strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-display text-lg text-white truncate" title={p.name}>{p.name}</h4>
                    <div className="flex items-center gap-3 mt-1 text-xs text-white/40">
                      <span className="flex items-center gap-1"><MessageSquare size={12} /> {p.session_count}</span>
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/60 transition-colors shrink-0 mt-3" />
              </div>

              {/* Readiness bar */}
              <div className="mt-4">
                <div className="flex items-center justify-between text-[11px] text-white/40 mb-1.5">
                  <span className="flex items-center gap-1"><Gauge size={12} /> Готовность паспорта</span>
                  <span className="font-mono text-white/60">{p.readiness_index}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-white/40 to-white/80 transition-all"
                    style={{ width: `${p.readiness_index}%` }}
                  />
                </div>
              </div>

              <div className="mt-4 w-full flex items-center justify-center gap-2 text-sm text-white/50 group-hover:text-white border border-white/10 group-hover:border-white/25 rounded-xl py-2.5 transition-all">
                <FolderOpen size={14} /> Открыть папку
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {openFolder && (
        <FolderModal
          project={openFolder}
          onClose={() => setOpenFolder(null)}
          onOpenSession={(sid) => onOpenSession?.(sid)}
          onSessionCreated={(s) => onSessionCreated?.(s)}
          onAttached={(sid, pid) => onAttached?.(sid, pid)}
          onCountChange={(pid, count) =>
            setProjects((prev) => prev.map((p) => (p.id === pid ? { ...p, session_count: count } : p)))
          }
          onEditPassport={() => { setEditProject(openFolder); setOpenFolder(null); }}
          onDeleted={(pid) => {
            setProjects((prev) => prev.filter((p) => p.id !== pid));
            onDeleted?.(pid);
          }}
        />
      )}

      {editProject && (
        <PassportModal
          projectId={editProject.id}
          projectName={editProject.name}
          onClose={() => setEditProject(null)}
          onSaved={(readiness) =>
            setProjects((prev) => prev.map((p) => (p.id === editProject.id ? { ...p, readiness_index: readiness } : p)))
          }
        />
      )}
    </div>
  );
}
