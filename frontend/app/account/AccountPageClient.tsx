"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMounted } from "@mantine/hooks";
import Layout from "@/components/Layout";
import { GlassCard, Button } from "@/components/shared";
import { clearToken, getToken } from "@/lib/auth";
import { postAuthJson, UserProfile } from "@/lib/api";
import { LogOut, User, Shield, ChevronLeft, CheckIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function AccountPageClient() {
  const router = useRouter();
  const mounted = useMounted();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [isAddEmailOpen, setIsAddEmailOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isChangeEmailOpen, setIsChangeEmailOpen] = useState(false);
  const [showEmailSentModal, setShowEmailSentModal] = useState(false);

  // Form states
  const [emailInput, setEmailInput] = useState("");
  const [emailStep, setEmailStep] = useState<"init" | "confirm">("init");
  const [emailForm, setEmailForm] = useState({ new: "", confirm: "", code: "" });
  const [passwordStep, setPasswordStep] = useState<"init" | "confirm">("init");
  const [passwordForm, setPasswordForm] = useState({ current: "", new: "", code: "" });
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      const token = getToken();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const data = await postAuthJson<UserProfile>("/me", {}, token);
        setUser(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, []);

  const handleLogout = async () => {
    await clearToken();
    router.push("/");
    router.refresh();
  };

  // ...

  const handleResendVerification = async () => {
    setIsResending(true);
    try {
      const token = getToken();
      if (token) {
        await postAuthJson("/auth/resend-verification", {}, token);
        setShowEmailSentModal(true);
      }
    } catch (e) {
      console.error(e);
      alert("Ошибка отправки письма");
    } finally {
      setIsResending(false);
    }
  };

  const handleAddEmail = async () => {
    try {
      const token = getToken();
      if (token) {
        await postAuthJson("/me", { email: emailInput }, token);
        setIsAddEmailOpen(false);
        setShowEmailSentModal(true);
        // Refresh user data
        const data = await postAuthJson<UserProfile>("/me", {}, token);
        setUser(data);
      }
    } catch (e) {
      console.error(e);
      alert("Ошибка добавления email");
    }
  };

  const handleInitiateChangePassword = async () => {
    try {
      const token = getToken();
      if (token) {
        await postAuthJson("/auth/change-password/initiate", {
          current_password: passwordForm.current,
        }, token);
        setPasswordStep("confirm");
      }
    } catch (e) {
      console.error(e);
      alert("Ошибка. Проверьте текущий пароль.");
    }
  };

  const handleConfirmChangePassword = async () => {
    try {
      const token = getToken();
      if (token) {
        await postAuthJson("/auth/change-password/confirm", {
          code: passwordForm.code,
          new_password: passwordForm.new,
        }, token);
        alert("Пароль успешно изменен!");
        setIsChangePasswordOpen(false);
        setPasswordForm({ current: "", new: "", code: "" });
        setPasswordStep("init");
      }
    } catch (e) {
      console.error(e);
      alert("Ошибка. Проверьте код.");
    }
  };

  const handleInitiateChangeEmail = async () => {
    // Basic validation
    if (!emailForm.new || !emailForm.confirm) {
      alert("Заполните все поля");
      return;
    }
    if (emailForm.new !== emailForm.confirm) {
      alert("Email адреса не совпадают");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailForm.new)) {
      alert("Некорректный формат Email");
      return;
    }

    try {
      const token = getToken();
      if (token) {
        // This triggers the backend to send a code to the new email
        // Note: The backend updates the email immediately but sets verified=False
        // We are using the existing behavior but guiding the user through a code flow
        await postAuthJson("/me", { email: emailForm.new }, token);
        setEmailStep("confirm");
      }
    } catch (e) {
      console.error(e);
      alert("Ошибка при смене Email. Возможно, этот email уже занят.");
    }
  };

  const handleConfirmChangeEmail = async () => {
    try {
      const token = getToken();
      if (token) {
        await postAuthJson("/auth/verify-email", {
          email: emailForm.new,
          code: emailForm.code
        }, token);

        alert("Email успешно изменен и подтвержден!");
        setIsChangeEmailOpen(false);
        setEmailForm({ new: "", confirm: "", code: "" });
        setEmailStep("init");

        // Refresh user data
        const data = await postAuthJson<UserProfile>("/me", {}, token);
        setUser(data);
      }
    } catch (e) {
      console.error(e);
      alert("Ошибка подтверждения кода.");
    }
  };

  if (!mounted) return null;

  if (loading) {
    return (
      <Layout>
        <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-pitchy-violet rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-[calc(100vh-5rem)] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => router.back()}
            className="flex items-center text-white/50 hover:text-white mb-8 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Назад
          </button>

          <header className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Аккаунт</h1>
            <p className="text-white/50">Управление вашим профилем</p>
          </header>

          <div className="space-y-6">
            {/* Profile Card */}
            <GlassCard hover={false} className="p-8">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-pitchy-violet/20 flex items-center justify-center border border-pitchy-violet/30">
                    <User className="w-8 h-8 text-pitchy-violet" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">{user?.name || "Пользователь"}</h2>
                    <div className="flex items-center gap-2">
                      <p className="text-white/50">{user?.email || "Email не указан"}</p>
                      {user?.email && !user?.email_verified && (
                        <span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/20">Не подтвержден</span>
                      )}
                      {user?.email && user?.email_verified && (
                        <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1">
                          <CheckIcon className="w-3 h-3" />
                          Подтвержден
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  variant="glass"
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/20"
                  onClick={handleLogout}
                  icon={<LogOut className="w-4 h-4" />}
                  iconPosition="left"
                >
                  Выйти
                </Button>
              </div>

              {/* Email Actions */}
              <div className="mt-6 pt-6 border-t border-white/10 flex flex-wrap gap-3">
                {/* Only show Add Email if social login */}
                {user?.is_social && !user?.email && (
                  <Button size="sm" variant="secondary" onClick={() => setIsAddEmailOpen(true)}>
                    Добавить Email
                  </Button>
                )}
                {user?.email && !user?.email_verified && (
                  <Button size="sm" variant="secondary" onClick={handleResendVerification} disabled={isResending}>
                    {isResending ? "Отправка..." : "Подтвердить Email"}
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => setIsChangeEmailOpen(true)}>
                  Сменить Email
                </Button>
              </div>
            </GlassCard>

            {/* Security Section */}
            <GlassCard hover={false} className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <Shield className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-semibold text-white">Безопасность</h3>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                <div>
                  <p className="text-white font-medium">Пароль</p>
                  <p className="text-xs text-white/40">Последнее изменение: никогда</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setIsChangePasswordOpen(true)}>Изменить</Button>
              </div>
            </GlassCard>

            <div className="mt-2 text-xs text-white/30">
              ID: {user?.id}
            </div>
          </div>
        </div>
      </div>

      {/* Add Email Modal */}
      {isAddEmailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <GlassCard className="w-full max-w-md p-6" hover={false}>
            <h3 className="text-xl font-bold text-white mb-4">Добавить Email</h3>
            <input
              type="email"
              placeholder="user@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="pitchy-input w-full mb-4"
            />
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setIsAddEmailOpen(false)}>Отмена</Button>
              <Button variant="primary" onClick={handleAddEmail}>Сохранить</Button>
            </div>
          </GlassCard>
        </div>
      )}

      {/* Change Password Modal (2 Steps) */}
      {isChangePasswordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <GlassCard className="w-full max-w-md p-6" hover={false}>
            <h3 className="text-xl font-bold text-white mb-4">Сменить пароль</h3>

            {passwordStep === "init" && (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Текущий пароль</label>
                    <input
                      type="password"
                      value={passwordForm.current}
                      onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                      className="pitchy-input w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Новый пароль</label>
                    <input
                      type="password"
                      value={passwordForm.new}
                      onChange={(e) => setPasswordForm({ ...passwordForm, new: e.target.value })}
                      className="pitchy-input w-full"
                    />
                    <p className="text-xs text-white/30 mt-1">Минимум 8 символов</p>
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <Button variant="ghost" onClick={() => setIsChangePasswordOpen(false)}>Отмена</Button>
                  <Button variant="primary" onClick={handleInitiateChangePassword}>Далее</Button>
                </div>
              </>
            )}

            {passwordStep === "confirm" && (
              <>
                <p className="text-white/70 text-sm mb-4">
                  Мы отправили код подтверждения на <b>{user?.email}</b>.
                  Введите его ниже для подтверждения смены пароля.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Код из письма</label>
                    <input
                      type="text"
                      placeholder="123456"
                      value={passwordForm.code}
                      onChange={(e) => setPasswordForm({ ...passwordForm, code: e.target.value })}
                      className="pitchy-input w-full text-center tracking-widest text-lg"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <Button variant="ghost" onClick={() => setPasswordStep("init")}>Назад</Button>
                  <Button variant="primary" onClick={handleConfirmChangePassword}>Подтвердить</Button>
                </div>
              </>
            )}
          </GlassCard>
        </div>
      )}

      {/* Change Email Modal */}
      {isChangeEmailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <GlassCard className="w-full max-w-md overflow-hidden relative" hover={false}>
            <motion.div layout className="p-6">
              <motion.h3 layout="position" className="text-xl font-bold text-white mb-4">Сменить Email</motion.h3>

              <AnimatePresence mode="wait">
                {emailStep === "init" && (
                  <motion.div
                    key="step-init"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="space-y-4">
                      <div>
                        <label className="text-xs text-white/50 mb-1 block">Новая почта</label>
                        <input
                          type="email"
                          placeholder="new@example.com"
                          value={emailForm.new}
                          onChange={(e) => setEmailForm({ ...emailForm, new: e.target.value })}
                          className="pitchy-input w-full"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-white/50 mb-1 block">Подтверждение почты</label>
                        <input
                          type="email"
                          placeholder="new@example.com"
                          value={emailForm.confirm}
                          onChange={(e) => setEmailForm({ ...emailForm, confirm: e.target.value })}
                          className="pitchy-input w-full"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 mt-6">
                      <Button variant="ghost" onClick={() => { setIsChangeEmailOpen(false); setEmailForm({ new: "", confirm: "", code: "" }); }}>Отмена</Button>
                      <Button variant="primary" onClick={handleInitiateChangeEmail}>Далее</Button>
                    </div>
                  </motion.div>
                )}

                {emailStep === "confirm" && (
                  <motion.div
                    key="step-confirm"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.2 }}
                  >
                    <p className="text-white/70 text-sm mb-4">
                      Мы отправили код подтверждения на <b>{emailForm.new}</b>.
                      Введите его ниже для подтверждения смены почты.
                    </p>
                    <div className="space-y-4">
                      <div>
                        <label className="text-xs text-white/50 mb-1 block">Код подтверждения</label>
                        <input
                          type="text"
                          placeholder="123456"
                          value={emailForm.code}
                          onChange={(e) => setEmailForm({ ...emailForm, code: e.target.value })}
                          className="pitchy-input w-full text-center tracking-widest text-lg"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 mt-6">
                      <Button variant="ghost" onClick={() => setEmailStep("init")}>Назад</Button>
                      <Button variant="primary" onClick={handleConfirmChangeEmail}>Подтвердить</Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </GlassCard>
        </div>
      )}

      {/* Email Sent Confirmation Modal */}
      {showEmailSentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <GlassCard className="w-full max-w-sm p-6 text-center" hover={false}>
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                <CheckIcon className="w-6 h-6 text-emerald-400" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Письмо отправлено!</h3>
            <p className="text-white/60 text-sm mb-6">
              Мы отправили ссылку для подтверждения на вашу почту.
              <br /><br />
              <span className="text-amber-400/80 text-xs">
                ⚠ Если письма нет во входящих, обязательно проверьте папку <b>Спам</b>.
              </span>
            </p>
            <Button variant="primary" className="w-full" onClick={() => setShowEmailSentModal(false)}>
              Хорошо
            </Button>
          </GlassCard>
        </div>
      )}
    </Layout>
  );
}
