"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HistoryCard } from "@/components/history/HistoryCard";
import { AnalysisItem, getAuthJson, AnalysisResult } from "@/lib/api";
import { getToken, authEvents } from "@/lib/auth";
import { Loader2, X, Sparkles, CheckCircle2, AlertTriangle, Lightbulb } from "lucide-react";
import { ScoreRing } from "@/components/ui/ScoreRing";

export function HistorySection() {
    const [history, setHistory] = useState<AnalysisItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisItem | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const fetchHistory = async () => {
        const token = getToken();
        if (!token) {
            setHistory([]);
            return;
        }

        setIsLoading(true);
        try {
            // Assuming GET /analysis returns AnalysisItem[]
            // Using generic type argument for getAuthJson
            const data = await getAuthJson<AnalysisItem[]>("/analysis", token);
            // Sort by new first (if backend doesn't sorting)
            // Assuming id increments or created_at
            const sorted = data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            setHistory(sorted);
        } catch (err) {
            console.error("Failed to fetch history", err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchHistory();

        const handleAuthChange = () => {
            fetchHistory();
        };

        authEvents.addEventListener("auth-change", handleAuthChange);
        // Also listen for "analysis-saved" if we implement it, 
        // or just rely on the user refreshing manually for new analyses if we don't have a global bus for that.
        // For now, let's add a custom event listener for "analysis-saved" too, 
        // and trigger it from ChatInterface when saving.
        window.addEventListener("analysis-saved", fetchHistory);

        return () => {
            authEvents.removeEventListener("auth-change", handleAuthChange);
            window.removeEventListener("analysis-saved", fetchHistory);
        };
    }, []);

    if (history.length === 0 && !isLoading) {
        return null;
    }

    // Construct AnalysisResult for modal from selectedAnalysis (which is AnalysisItem)
    // We need to map AnalysisItem (backend shape) to AnalysisResult (frontend UI shape used in ChatInterface)
    // AnalysisItem = AnalyzeResponse & { id, name, created_at }
    // AnalyzeResponse = { investment_score, strengths, weaknesses, recommendations, market_summary }
    // AnalysisResult = { name, score, breakdown, strengths, risks, recommendation, summary }

    const getAnalysisResult = (item: AnalysisItem): AnalysisResult => {
        const score = Math.round(item.investment_score * 10);
        return {
            name: item.name || "Стартап",
            score: score,
            breakdown: {
                market: score,
                team: score,
                product: score,
                traction: score,
                financials: score,
            },
            strengths: item.strengths || [],
            risks: item.weaknesses || [],
            recommendation: item.recommendations?.[0] || "Нет рекомендаций",
            summary: item.market_summary || "",
        };
    };

    return (
        <section className="relative py-12 border-t border-white/5 bg-black/20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center gap-2 mb-8">
                    <div className="p-2 rounded-lg bg-pitchy-violet/10">
                        <Sparkles className="w-5 h-5 text-pitchy-violet" />
                    </div>
                    <h2 className="text-xl font-bold text-white">История анализов</h2>
                </div>

                {isLoading && history.length === 0 ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="w-6 h-6 text-white/20 animate-spin" />
                    </div>
                ) : (
                    <div
                        ref={scrollContainerRef}
                        className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent snap-x"
                    >
                        {history.map(item => (
                            <HistoryCard
                                key={item.id}
                                item={item}
                                onClick={() => setSelectedAnalysis(item)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Full Analysis Modal */}
            <AnimatePresence>
                {selectedAnalysis && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setSelectedAnalysis(null)}
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto glass-panel rounded-2xl p-6 md:p-8 shadow-2xl"
                        >
                            <button
                                onClick={() => setSelectedAnalysis(null)}
                                className="absolute top-4 right-4 p-2 text-white/50 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                            >
                                <X className="w-5 h-5" />
                            </button>

                            {/* Reusing logic similar to ChatInterface result display */}
                            {(() => {
                                const analysis = getAnalysisResult(selectedAnalysis);
                                return (
                                    <div>
                                        <div className="flex flex-col sm:flex-row gap-6 mb-8 mt-2">
                                            <ScoreRing score={analysis.score} size="lg" />
                                            <div>
                                                <h3 className="text-2xl font-bold text-white mb-2">{analysis.name}</h3>
                                                <p className="text-white/60 leading-relaxed text-sm">{analysis.summary}</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                                            {analysis.strengths.length > 0 && (
                                                <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                                                    <h4 className="text-xs font-medium text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                                        Сильные стороны
                                                    </h4>
                                                    <ul className="space-y-2">
                                                        {analysis.strengths.map((s, i) => (
                                                            <li key={i} className="text-sm text-white/70 flex items-start gap-2">
                                                                <span className="w-1 h-1 rounded-full bg-emerald-400 mt-2 flex-shrink-0" />
                                                                {s}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}

                                            {analysis.risks.length > 0 && (
                                                <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10">
                                                    <h4 className="text-xs font-medium text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                                        <AlertTriangle className="w-3.5 h-3.5" />
                                                        Риски
                                                    </h4>
                                                    <ul className="space-y-2">
                                                        {analysis.risks.map((r, i) => (
                                                            <li key={i} className="text-sm text-white/70 flex items-start gap-2">
                                                                <span className="w-1 h-1 rounded-full bg-amber-400 mt-2 flex-shrink-0" />
                                                                {r}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>

                                        <div className="p-4 rounded-xl bg-pitchy-violet/10 border border-pitchy-violet/20">
                                            <h4 className="text-xs font-medium text-pitchy-violet uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                                <Lightbulb className="w-3.5 h-3.5" />
                                                Рекомендация
                                            </h4>
                                            <p className="text-sm text-white/80">
                                                {analysis.recommendation}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })()}
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </section>
    );
}
