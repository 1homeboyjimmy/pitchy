"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { TextType } from "../reactbits/TextType";
import { FadeContent } from "../reactbits/FadeContent";
import { AnimatedButton } from "../ui-custom/AnimatedButton";
import { ScoreCard } from "../ui-custom/ScoreCard";
import { AnalyzeResponse, postAuthJson, postJson } from "@/lib/api";
import { getToken } from "@/lib/auth";

interface ScoreResult {
  score: number;
  strengths: string[];
  weaknesses: string[];
  explanation: string;
}

export function HomePage() {
  const [query, setQuery] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleAnalyze = async () => {
    if (!query.trim()) return;
    setError(null);
    setIsAnalyzing(true);
    try {
      const data = await postJson<AnalyzeResponse>("/analyze-startup", {
        description: query,
      });
      const explanation = [
        data.market_summary,
        data.recommendations.length ? `\nRecommendations:\n- ${data.recommendations.join("\n- ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      setResult({
        score: Math.max(0, Math.min(100, data.investment_score * 10)),
        strengths: data.strengths,
        weaknesses: data.weaknesses,
        explanation,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSave = async () => {
    const token = getToken();
    if (!token || !query.trim() || !result) {
      setError("Login required to save analyses.");
      return;
    }
    setIsSaving(true);
    try {
      await postAuthJson(
        "/analysis",
        {
          name: "Quick analysis",
          description: query,
          category: null,
          stage: null,
          url: null,
        },
        token
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setIsSaving(false);
    }
  };

  const quickTags = useMemo(
    () => ["SaaS", "Fintech", "AI/ML", "HealthTech", "E-commerce"],
    []
  );

  return (
    <div className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center px-4 py-12 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-violet-950/20 via-transparent to-transparent pointer-events-none" />

      <div className="relative z-10 w-full max-w-4xl mx-auto text-center">
        <FadeContent delay={0.2}>
          <motion.div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500/10 border border-violet-500/20 mb-8"
            whileHover={{ scale: 1.05 }}
          >
            <Sparkles className="w-4 h-4 text-violet-400" />
            <span className="text-sm text-violet-300">
              Инвестиционный анализ на базе ИИ
            </span>
          </motion.div>
        </FadeContent>

        <div className="mb-6">
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-4 leading-tight">
            <TextType text="Анализируйте Стартапы" delay={400} speed={60} />
          </h1>
          <h1 className="text-5xl md:text-7xl font-bold leading-tight">
            <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              <TextType text="Профессионально" delay={800} speed={60} />
            </span>
          </h1>
        </div>

        <FadeContent delay={1.2} className="mb-12">
          <p className="text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto">
            Введите описание стартапа, сайт или ссылку на презентацию. Наш ИИ
            проанализирует инвестиционный потенциал за секунды.
          </p>
        </FadeContent>

        <FadeContent delay={1.4} className="mb-8">
          <div className="relative max-w-2xl mx-auto">
            <motion.div className="relative" whileFocus={{ scale: 1.02 }}>
              <textarea
                id="startup-description"
                name="startupDescription"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleAnalyze();
                  }
                }}
                placeholder="Опишите стартап, вставьте ссылку на сайт или pitch deck..."
                className="w-full h-32 bg-zinc-900/80 backdrop-blur-sm border border-zinc-700 rounded-2xl p-5 text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 resize-none transition-all duration-300"
                disabled={isAnalyzing}
              />

              <div className="absolute bottom-4 right-4">
                <AnimatedButton
                  onClick={handleAnalyze}
                  disabled={!query.trim() || isAnalyzing}
                  size="md"
                  icon={
                    isAnalyzing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ArrowRight className="w-4 h-4" />
                    )
                  }
                >
                  {isAnalyzing ? "Анализ..." : "Анализировать"}
                </AnimatedButton>
              </div>
            </motion.div>
          </div>
        </FadeContent>

        {error ? (
          <FadeContent delay={0.1} className="mb-6">
            <div className="text-sm text-red-400">
              {error === "Login required to save analyses." ? "Войдите, чтобы сохранить анализ." : error}
            </div>
          </FadeContent>
        ) : null}

        <FadeContent delay={1.6}>
          <div className="flex flex-wrap justify-center gap-2 mb-16">
            {quickTags.map((tag, index) => (
              <motion.button
                key={tag}
                onClick={() => setQuery(`Проанализируй стартап в сфере ${tag}, который `)}
                className="px-4 py-2 rounded-full bg-zinc-900/50 border border-zinc-800 text-zinc-400 text-sm hover:bg-zinc-800 hover:text-zinc-200 transition-colors duration-200"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.8 + index * 0.1 }}
              >
                {tag}
              </motion.button>
            ))}
          </div>
        </FadeContent>

        <AnimatePresence>
          {result ? (
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="mt-8"
            >
              <ScoreCard {...result} />

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="mt-8 flex justify-center gap-4"
              >
                <AnimatedButton
                  variant="outline"
                  onClick={() => {
                    setResult(null);
                    setQuery("");
                  }}
                >
                  Новый анализ
                </AnimatedButton>
                <AnimatedButton onClick={handleSave} disabled={isSaving}>
                  {isSaving ? "Сохранение..." : "Сохранить"}
                </AnimatedButton>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>

      </div>
    </div>
  );
}
