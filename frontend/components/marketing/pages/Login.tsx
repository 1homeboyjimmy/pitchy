"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, User, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FadeContent } from "../reactbits/FadeContent";
import { AnimatedButton } from "../ui-custom/AnimatedButton";
import { InputField } from "../ui-custom/InputField";
import { postJson } from "@/lib/api";
import { setToken } from "@/lib/auth";

type Tab = "login" | "register" | "reset";

export function LoginPage() {
  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const router = useRouter();

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setName("");
    setError(null);
    setSuccessMessage(null);
  };

  const switchTab = (newTab: Tab) => {
    resetForm();
    setTab(newTab);
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const data = await postJson<{ access_token: string }>("/auth/login", {
        email,
        password,
      });
      setToken(data.access_token);
      router.push("/account");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8 || password.length > 72) {
      setError("Password must be 8–72 characters long.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await postJson<{ access_token: string }>("/auth/register", {
        email,
        password,
        name,
      });
      setToken(data.access_token);
      setSuccessMessage("Account created! Check your email to verify.");
      setTimeout(() => router.push("/account"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      await postJson("/auth/request-password-reset", { email });
      setSuccessMessage("If that email exists, a reset link has been sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setIsLoading(false);
    }
  };

  const titles: Record<Tab, { heading: string; subtitle: string }> = {
    login: {
      heading: "С возвращением",
      subtitle: "Войдите в свой аккаунт pitchy.pro",
    },
    register: {
      heading: "Создать аккаунт",
      subtitle: "Начните с анализа на базе ИИ",
    },
    reset: {
      heading: "Сброс пароля",
      subtitle: "Мы отправим ссылку для сброса",
    },
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center px-4 py-12 relative">
      <div className="absolute inset-0 bg-gradient-to-br from-violet-950/20 via-transparent to-zinc-950 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        <FadeContent delay={0.2}>
          <motion.div
            className="bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 rounded-3xl p-8"
            initial={{ y: 20 }}
            animate={{ y: 0 }}
          >
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-white mb-3 leading-tight">
                {titles[tab].heading}
              </h1>
              <p className="text-zinc-400">{titles[tab].subtitle}</p>
            </div>

            {/* Tab switcher */}
            {tab !== "reset" ? (
              <div className="flex items-center bg-zinc-800/50 rounded-xl p-1 mb-6">
                <button
                  onClick={() => switchTab("login")}
                  className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${tab === "login"
                    ? "bg-violet-600 text-white shadow-lg"
                    : "text-zinc-400 hover:text-white"
                    }`}
                >
                  Войти
                </button>
                <button
                  onClick={() => switchTab("register")}
                  className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${tab === "register"
                    ? "bg-violet-600 text-white shadow-lg"
                    : "text-zinc-400 hover:text-white"
                    }`}
                >
                  Регистрация
                </button>
              </div>
            ) : null}

            <AnimatePresence mode="wait">
              {successMessage ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="text-center py-8"
                >
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/10 flex items-center justify-center">
                    <span className="text-3xl">✓</span>
                  </div>
                  <p className="text-green-400 text-sm">{successMessage}</p>
                </motion.div>
              ) : (
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, x: tab === "register" ? 20 : -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: tab === "register" ? -20 : 20 }}
                  transition={{ duration: 0.2 }}
                >
                  {/* Login form */}
                  {tab === "login" ? (
                    <form onSubmit={handleLogin} className="space-y-4">
                      <InputField
                        label="Email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        icon={<Mail className="w-5 h-5" />}
                        required
                      />
                      <InputField
                        label="Пароль"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        icon={<Lock className="w-5 h-5" />}
                        required
                      />

                      {error ? (
                        <p className="text-sm text-red-400">{error === "Login failed" ? "Ошибка входа" : error}</p>
                      ) : null}

                      <div className="flex items-center justify-between text-sm">
                        <label className="flex items-center gap-2 text-zinc-400 cursor-pointer">
                          <input
                            type="checkbox"
                            className="rounded bg-zinc-800 border-zinc-700 text-violet-600"
                          />
                          Запомнить меня
                        </label>
                        <button
                          type="button"
                          onClick={() => switchTab("reset")}
                          className="text-violet-400 hover:text-violet-300 transition-colors"
                        >
                          Забыли пароль?
                        </button>
                      </div>

                      <AnimatedButton
                        type="submit"
                        className="w-full"
                        disabled={isLoading}
                        icon={
                          isLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : undefined
                        }
                      >
                        {isLoading ? "Вход..." : "Войти"}
                      </AnimatedButton>
                    </form>
                  ) : null}

                  {/* Register form */}
                  {tab === "register" ? (
                    <form onSubmit={handleRegister} className="space-y-4">
                      <InputField
                        label="Имя"
                        type="text"
                        placeholder="Ваше имя"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        icon={<User className="w-5 h-5" />}
                        required
                      />
                      <InputField
                        label="Email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        icon={<Mail className="w-5 h-5" />}
                        required
                      />
                      <InputField
                        label="Пароль"
                        type="password"
                        placeholder="8–72 символов"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        icon={<Lock className="w-5 h-5" />}
                        required
                      />

                      {/* Password strength indicator */}
                      {password ? (
                        <div className="space-y-1">
                          <div className="flex gap-1">
                            {[1, 2, 3, 4].map((level) => (
                              <div
                                key={level}
                                className={`h-1 flex-1 rounded-full transition-colors ${password.length >= level * 3
                                  ? level <= 1
                                    ? "bg-red-500"
                                    : level <= 2
                                      ? "bg-orange-500"
                                      : level <= 3
                                        ? "bg-yellow-500"
                                        : "bg-green-500"
                                  : "bg-zinc-800"
                                  }`}
                              />
                            ))}
                          </div>
                          <p className="text-xs text-zinc-500">
                            {password.length < 8
                              ? `Нужно еще ${8 - password.length} симв.`
                              : "Надежный пароль"}
                          </p>
                        </div>
                      ) : null}

                      {error ? (
                        <p className="text-sm text-red-400">{error === "Registration failed" ? "Ошибка регистрации" : error === "Password must be 8–72 characters long." ? "Пароль должен быть от 8 до 72 символов." : error}</p>
                      ) : null}

                      <AnimatedButton
                        type="submit"
                        className="w-full"
                        disabled={isLoading}
                        icon={
                          isLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : undefined
                        }
                      >
                        {isLoading ? "Создание аккаунта..." : "Создать аккаунт"}
                      </AnimatedButton>
                    </form>
                  ) : null}

                  {/* Reset password form */}
                  {tab === "reset" ? (
                    <form onSubmit={handleResetPassword} className="space-y-4">
                      <InputField
                        label="Email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        icon={<Mail className="w-5 h-5" />}
                        required
                      />

                      {error ? (
                        <p className="text-sm text-red-400">{error === "Request failed" ? "Ошибка запроса" : error}</p>
                      ) : null}

                      <AnimatedButton
                        type="submit"
                        className="w-full"
                        disabled={isLoading}
                        icon={
                          isLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : undefined
                        }
                      >
                        {isLoading ? "Отправка..." : "Отправить ссылку"}
                      </AnimatedButton>

                      <button
                        type="button"
                        onClick={() => switchTab("login")}
                        className="w-full text-sm text-zinc-400 hover:text-white transition-colors py-2"
                      >
                        ← Вернуться ко входу
                      </button>
                    </form>
                  ) : null}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </FadeContent>
      </div>
    </div>
  );
}
