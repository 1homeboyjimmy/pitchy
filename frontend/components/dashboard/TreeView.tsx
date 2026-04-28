"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, Loader, Star, GitBranch, AlertCircle } from "react-feather";
import { TreeCanvas } from "./TreeCanvas";
import { TreeChatInterface } from "./TreeChatInterface";
import type { TreeNodeResponse, TreeEdgeResponse } from "../../lib/api";
import { GlassCard } from "@/components/shared";
import { getToken } from "@/lib/auth";

/* ——— Component ——— */

type TreeState = {
  id?: number;
  nodes: TreeNodeResponse[];
  edges: TreeEdgeResponse[];
  readinessIndex: number;
  status: "idle" | "uploading" | "generating" | "ready" | "error";
  error?: string;
};

type Props = {
  onSwitchToChat?: (context?: string) => void;
};

export function TreeView({ }: Props) {
  const [tree, setTree] = useState<TreeState>({ nodes: [], edges: [], readinessIndex: 0, status: "idle" });
  const [description, setDescription] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeChatNode, setActiveChatNode] = useState<TreeNodeResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load user's trees on mount
  useEffect(() => {
    const loadTrees = async () => {
      try {
        const token = getToken();
        if (!token) return;
        const res = await fetch("/tree/list", {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          if (data.length > 0) {
            const latest = data[0];
            if (latest.status === "error") {
              // Don't show loading for failed trees — show idle with error
              setTree({
                nodes: [],
                edges: [],
                readinessIndex: 0,
                status: "idle",
                error: "Предыдущая генерация завершилась ошибкой. Попробуйте снова.",
              });
            } else if (latest.tree_data?.nodes?.length > 0) {
              setTree({
                id: latest.id,
                nodes: latest.tree_data.nodes,
                edges: latest.tree_data?.edges || [],
                readinessIndex: latest.readiness_index || 0,
                status: "ready",
              });
            }
          }
        }
      } catch {
        // ignore — no trees yet
      }
    };
    loadTrees();
  }, []);

  const handleCreateFromText = useCallback(async () => {
    if (!description.trim() || description.trim().length < 10) return;

    setTree((prev) => ({ ...prev, status: "generating", error: undefined }));

    try {
      const token = getToken();
      if (!token) throw new Error("Необходима авторизация");

      const res = await fetch("/tree/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        credentials: "include",
        body: JSON.stringify({ description: description.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Ошибка создания");
      }

      const data = await res.json();
      setTree({
        id: data.id,
        nodes: data.tree_data?.nodes || [],
        edges: data.tree_data?.edges || [],
        readinessIndex: data.readiness_index || 0,
        status: "ready",
      });
    } catch (e) {
      // Fallback to demo tree for development
      setTree({
        nodes: [],
        edges: [],
        readinessIndex: 0,
        status: "idle",
        error: e instanceof Error ? e.message : "Ошибка создания дерева.",
      });
    }
  }, [description]);

  const handleUploadPdf = useCallback(async (file: File) => {
    setTree((prev) => ({ ...prev, status: "uploading", error: undefined }));

    try {
      const token = getToken();
      if (!token) throw new Error("Необходима авторизация");

      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/tree/upload-pdf", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Ошибка загрузки PDF");
      }

      const data = await res.json();
      setTree({
        id: data.id,
        nodes: data.tree_data?.nodes || [],
        edges: data.tree_data?.edges || [],
        readinessIndex: data.readiness_index || 0,
        status: "ready",
      });
    } catch (e) {
      setTree({
        nodes: [],
        edges: [],
        readinessIndex: 0,
        status: "idle",
        error: e instanceof Error ? e.message : "Ошибка загрузки PDF.",
      });
    }
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUploadPdf(file);
    },
    [handleUploadPdf],
  );


  const handleUpdateTree = useCallback((nodes: TreeNodeResponse[], readiness: number, edges?: TreeEdgeResponse[]) => {
    setTree((prev) => ({
      ...prev,
      nodes,
      readinessIndex: readiness,
      edges: edges || prev.edges
    }));
  }, []);


  // ——— Idle / Empty State ———
  if (tree.status === "idle" && tree.nodes.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col h-[calc(100vh-8rem)]"
      >
        {/* Error banner */}
        <AnimatePresence>
          {tree.error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-none bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[13px] font-code"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              {tree.error}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-16 h-16 rounded-none bg-[#111111] border border-white/10 flex items-center justify-center mb-6">
            <GitBranch className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-2xl font-display font-bold text-white mb-2 text-center tracking-tight">
            Древо принятия решений
          </h3>
          <p className="text-[13px] font-code text-neutral-500 mb-8 max-w-md text-center">
            Загрузите PDF-документ или опишите идею стартапа — ИИ построит интерактивное древо анализа.
          </p>

          <div className="w-full max-w-lg space-y-4">
            {/* Text input */}
            <div className="bg-[#111111] border border-white/10 p-6">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Опишите идею стартапа (минимум 10 символов)..."
                className="w-full bg-transparent text-white font-body-sm text-[14px] placeholder-neutral-600 resize-none outline-none min-h-[100px]"
              />
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
                <span className="font-code text-[11px] text-neutral-500">{description.length} символов</span>
                <button
                  onClick={handleCreateFromText}
                  disabled={description.trim().length < 10}
                  className="flex items-center gap-2 px-4 py-2 bg-white text-black font-mono-label text-[10px] uppercase font-bold disabled:opacity-50 hover:opacity-90 transition-opacity cursor-pointer"
                >
                  <Star className="w-3.5 h-3.5" />
                  Построить древо
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/10" />
              <span className="font-code text-[10px] uppercase tracking-widest text-neutral-500">или</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* PDF Upload */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-3 px-6 py-6 border border-dashed border-white/20 bg-[#111111] hover:border-white/40 transition-all group cursor-pointer"
            >
              <Upload className="w-5 h-5 text-neutral-500 group-hover:text-white transition-colors" />
              <span className="font-mono-label text-[11px] uppercase tracking-widest text-neutral-500 group-hover:text-white transition-colors">
                Загрузить PDF-документ
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </div>
      </motion.div>
    );
  }

  // ——— Loading / Generating State ———
  if (tree.status === "uploading" || tree.status === "generating") {
    return (
      <div className="flex flex-col h-[calc(100vh-8rem)] items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="w-16 h-16 bg-[#111111] border border-white/20 flex items-center justify-center mb-6"
        >
          <Loader className="w-8 h-8 text-white" />
        </motion.div>
        <h3 className="text-2xl font-display font-bold text-white mb-2 tracking-tight">
          {tree.status === "uploading" ? "Загрузка PDF..." : "ИИ строит древо..."}
        </h3>
        <p className="font-code text-[13px] text-neutral-500">Это может занять до 30 секунд</p>
      </div>
    );
  }

  // ——— Tree Ready ———
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-[calc(100vh-5rem)] -m-8"
    >
      {/* Header Info */}
      <div className="p-8 pb-0 z-10">
        <div className="flex justify-between items-start">
            <div>
            <h2 className="text-3xl font-display font-bold text-white tracking-tight">Древо принятия решений</h2>
            <p className="font-mono-label text-[11px] text-neutral-500 mt-1 uppercase tracking-widest">AI-ВИЗУАЛИЗАЦИЯ ГОТОВНОСТИ ВАШЕГО СТАРТАПА</p>
            </div>
            <div className="flex space-x-2">
            <button onClick={() => {
                setTree({ nodes: [], edges: [], readinessIndex: 0, status: "idle" });
                setDescription("");
            }} className="border border-white/10 bg-[#111111] text-white px-4 py-2 font-mono-label text-[10px] uppercase font-bold hover:bg-white/5 transition-all flex items-center gap-2">
                <FileText className="w-3.5 h-3.5" /> НОВОЕ ДРЕВО
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="bg-white text-black px-4 py-2 font-mono-label text-[10px] uppercase font-bold hover:opacity-90 transition-opacity flex items-center gap-2">
                <Upload className="w-3.5 h-3.5" /> ЗАГРУЗИТЬ PDF
            </button>
            </div>
        </div>
        <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
      </div>

      <AnimatePresence>
        {tree.error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mx-8 mt-4 flex items-center gap-2 px-4 py-2.5 rounded-none bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[13px] font-code"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            {tree.error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Canvas */}
      <div className="flex-1 relative flex items-center justify-center overflow-auto mt-6 mb-8 mx-8">
        <div className="flex-1 relative w-full h-full">
           <TreeCanvas
             treeNodes={tree.nodes}
             treeEdges={tree.edges}
             readinessIndex={tree.readinessIndex}
             onNodeClick={(node) => {
               setActiveChatNode(node);
               setIsChatOpen(true);
             }}
           />
        </div>

        <AnimatePresence>
          {isChatOpen && tree.id && (
            <motion.div
              initial={{ x: 400, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 400, opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 200 }}
              className="h-full z-40"
            >
              <TreeChatInterface
                treeId={tree.id}
                activeNode={activeChatNode}
                onUpdateTree={handleUpdateTree}
                onClose={() => setIsChatOpen(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
