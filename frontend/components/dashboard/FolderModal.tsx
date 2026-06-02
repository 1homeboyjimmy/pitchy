"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "@mantine/hooks";
import {
  X, Loader, FolderOpen, MessageSquare, Plus, Calendar,
  Gauge, BrainCircuit, ChevronRight, FolderInput, Pencil, Trash2, AlertTriangle,
} from "lucide-react";
import {
  getProjectSessions, getChatSessions, createChatSession, attachSessionToProject, deleteProject,
  type ProjectListItem, type ChatSessionResponse,
} from "@/lib/api";
import { getToken } from "@/lib/auth";
import { notifyError, notifySuccess } from "@/lib/ui";

interface Props {
  project: ProjectListItem;
  onClose: () => void;
  /** Открыть чат в дашборде (переключить активную сессию + таб). */
  onOpenSession: (sessionId: number) => void;
  /** Новый чат создан — добавить в общий список сессий дашборда. */
  onSessionCreated: (session: ChatSessionResponse) => void;
  /** Чат привязан к папке — синхронизировать project_id в списке дашборда. */
  onAttached: (sessionId: number, projectId: number) => void;
  /** Сколько чатов сейчас в папке — обновить счётчик на карточке. */
  onCountChange: (projectId: number, count: number) => void;
  /** Открыть редактор паспорта этой папки. */
  onEditPassport: () => void;
  /** Папка удалена — убрать карточку из дашборда. */
  onDeleted: (projectId: number) => void;
}

function formatDate(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) +
      ", " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch { return s; }
}

export function FolderModal({
  project, onClose, onOpenSession, onSessionCreated, onAttached, onCountChange, onEditPassport, onDeleted,
}: Props) {
  const mounted = useMounted();
  const [loading, setLoading] = useState(true);
  const [folderSessions, setFolderSessions] = useState<ChatSessionResponse[]>([]);
  const [allSessions, setAllSessions] = useState<ChatSessionResponse[]>([]);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const t = getToken();
    if (!t) { setLoading(false); return; }
    (async () => {
      try {
        const [inFolder, all] = await Promise.all([
          getProjectSessions(project.id, t),
          getChatSessions(t),
        ]);
        setFolderSessions(inFolder);
        setAllSessions(all);
        onCountChange(project.id, inFolder.length);
      } catch (e) {
        console.error(e);
        notifyError("Не удалось загрузить чаты папки");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // Чаты, которых ещё нет в этой папке — кандидаты на перемещение.
  const candidates = useMemo(() => {
    const inFolder = new Set(folderSessions.map((s) => s.id));
    return allSessions.filter((s) => !inFolder.has(s.id));
  }, [allSessions, folderSessions]);

  const openChat = (id: number) => {
    onClose();
    onOpenSession(id);
  };

  const createInFolder = async () => {
    const t = getToken();
    if (!t) return;
    setCreating(true);
    try {
      const session = await createChatSession({ title: "Чат с аналитиком" }, t);
      await attachSessionToProject(project.id, session.id, t);
      const withFolder = { ...session, project_id: project.id };
      onSessionCreated(withFolder);
      onCountChange(project.id, folderSessions.length + 1);
      notifySuccess("Чат создан в папке");
      onClose();
      onOpenSession(session.id);
    } catch (e) {
      console.error(e);
      notifyError("Не удалось создать чат в папке");
    } finally {
      setCreating(false);
    }
  };

  const addExisting = async (s: ChatSessionResponse) => {
    const t = getToken();
    if (!t) return;
    setBusyId(s.id);
    try {
      await attachSessionToProject(project.id, s.id, t);
      const moved = { ...s, project_id: project.id };
      setFolderSessions((prev) => [moved, ...prev]);
      setAllSessions((prev) => prev.map((x) => (x.id === s.id ? moved : x)));
      onAttached(s.id, project.id);
      onCountChange(project.id, folderSessions.length + 1);
      notifySuccess("Чат добавлен в папку");
    } catch (e) {
      console.error(e);
      notifyError("Не удалось переместить чат");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    const t = getToken();
    if (!t) return;
    setDeleting(true);
    try {
      await deleteProject(project.id, t);
      onDeleted(project.id);
      notifySuccess("Папка удалена");
      onClose();
    } catch (e) {
      console.error(e);
      notifyError("Не удалось удалить папку");
      setDeleting(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[88vh] bg-neutral-950 border border-white/10 rounded-3xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center shrink-0">
              <FolderOpen className="text-white/60" size={20} strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-xl text-white truncate" title={project.name}>{project.name}</h2>
              <div className="flex items-center gap-1.5 mt-0.5 text-white/40 text-xs">
                <Gauge size={12} /> Готовность паспорта {project.readiness_index}%
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white p-2 rounded-xl hover:bg-white/5 transition-all shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Memory hint */}
        <div className="px-6 pt-4">
          <div className="flex items-start gap-2.5 rounded-2xl bg-violet-500/[0.07] border border-violet-500/15 px-4 py-3">
            <BrainCircuit size={16} className="text-violet-300/80 shrink-0 mt-0.5" />
            <p className="text-white/55 text-xs leading-relaxed">
              Чаты в этой папке делят общую память: факты и паспорт проекта автоматически
              переносятся между всеми чатами внутри папки.
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading ? (
            <div className="flex justify-center py-12"><Loader className="animate-spin text-white/30" size={24} /></div>
          ) : (
            <>
              {/* New chat in folder */}
              <button
                onClick={createInFolder}
                disabled={creating}
                className="w-full border border-dashed border-white/15 hover:border-white/30 hover:bg-white/[0.03] transition-all rounded-2xl px-4 py-3.5 flex items-center gap-3 group disabled:opacity-50"
              >
                <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/5 flex items-center justify-center group-hover:bg-white group-hover:text-black transition-colors">
                  {creating ? <Loader className="animate-spin" size={16} /> : <Plus size={18} />}
                </div>
                <span className="font-display text-sm text-white/90">Новый чат в папке</span>
              </button>

              {/* Chats in folder */}
              <div>
                <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-3 flex items-center gap-2">
                  <MessageSquare size={12} /> Чаты в папке · {folderSessions.length}
                </h3>
                {folderSessions.length === 0 ? (
                  <p className="text-white/30 text-sm py-3">Пока нет чатов в этой папке.</p>
                ) : (
                  <div className="space-y-2">
                    {folderSessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => openChat(s.id)}
                        className="w-full lovable-glass border border-white/5 hover:border-white/15 hover:bg-white/[0.04] transition-all rounded-2xl px-4 py-3 flex items-center gap-3 text-left group"
                      >
                        <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center shrink-0">
                          <MessageSquare className="text-white/50" size={16} strokeWidth={1.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-sm truncate">{s.title || "Чат с аналитиком"}</div>
                          <div className="flex items-center gap-1.5 text-white/35 text-[11px] mt-0.5">
                            <Calendar size={11} /> {formatDate(s.created_at)}
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/60 transition-colors shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Add existing chat */}
              <div>
                <button
                  onClick={() => setShowAdd((v) => !v)}
                  className="w-full flex items-center gap-2 text-white/50 hover:text-white text-sm transition-colors py-2"
                >
                  <FolderInput size={15} />
                  Добавить существующий чат
                  <ChevronRight size={14} className={`ml-auto transition-transform ${showAdd ? "rotate-90" : ""}`} />
                </button>
                {showAdd && (
                  candidates.length === 0 ? (
                    <p className="text-white/30 text-xs py-2 px-1">Все ваши чаты уже в этой папке.</p>
                  ) : (
                    <div className="space-y-2 mt-1 max-h-56 overflow-y-auto pr-1">
                      {candidates.map((s) => (
                        <div
                          key={s.id}
                          className="w-full bg-white/[0.02] border border-white/5 rounded-2xl px-4 py-2.5 flex items-center gap-3"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-white/80 text-sm truncate">{s.title || "Чат с аналитиком"}</div>
                            {s.project_id != null && (
                              <div className="text-white/30 text-[11px] mt-0.5">уже в другой папке</div>
                            )}
                          </div>
                          <button
                            onClick={() => addExisting(s)}
                            disabled={busyId === s.id}
                            className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-white hover:text-black transition-all disabled:opacity-40"
                          >
                            {busyId === s.id ? <Loader className="animate-spin" size={13} /> : <Plus size={13} />}
                            Добавить
                          </button>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {confirmDelete ? (
          <div className="px-6 py-4 border-t border-white/10 bg-red-500/[0.04]">
            <div className="flex items-start gap-2.5 mb-3">
              <AlertTriangle size={16} className="text-red-400/80 shrink-0 mt-0.5" />
              <p className="text-white/60 text-xs leading-relaxed">
                Удалить папку «{project.name}»? Паспорт и общая память проекта будут удалены безвозвратно.
                Сами чаты сохранятся — они просто открепятся от папки.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="text-sm text-white/50 hover:text-white px-4 py-2 rounded-full transition-all disabled:opacity-40"
              >
                Отмена
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-2 text-sm text-white bg-red-500/90 hover:bg-red-500 rounded-full px-5 py-2.5 transition-all disabled:opacity-50"
              >
                {deleting ? <Loader className="animate-spin" size={14} /> : <Trash2 size={14} />} Удалить папку
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-white/10">
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2 text-sm text-white/40 hover:text-red-400 border border-white/10 hover:border-red-500/30 rounded-full px-4 py-2.5 transition-all"
            >
              <Trash2 size={14} /> Удалить
            </button>
            <button
              onClick={onEditPassport}
              className="flex items-center gap-2 text-sm text-white/60 hover:text-white border border-white/10 hover:border-white/25 rounded-full px-5 py-2.5 transition-all"
            >
              <Pencil size={14} /> Редактировать паспорт
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
