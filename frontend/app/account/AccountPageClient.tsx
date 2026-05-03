"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMounted } from "@mantine/hooks";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";
import { clearToken, getToken } from "@/lib/auth";
import { postAuthJson, patchAuthJson, UserProfile } from "@/lib/api";
import { LogOut, User, Shield, CheckCircle2, ChevronLeft, Check } from "lucide-react";
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
        await patchAuthJson("/me", { email: emailInput }, token);
        setIsAddEmailOpen(false);
        setShowEmailSentModal(true);
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
        await patchAuthJson("/me", { email: emailForm.new }, token);
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
      <div className="bg-[#0A0A0A] min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  const isEmailVerified = user?.email && (user?.email_verified || user?.is_social);
  const isEmailUnverified = user?.email && !user?.email_verified && !user?.is_social;
  const isEmailMissing = user?.is_social && !user?.email;

  const subscriptionLabel = user?.subscription_tier === 'premium' ? 'Премиум' 
    : user?.subscription_tier === 'pro' ? 'Pro' 
    : user?.subscription_tier === 'starter' ? 'Starter' 
    : user?.subscription_tier === 'tester' ? 'Tester' 
    : 'Бесплатный';

  return (
    <div className="bg-black text-white antialiased min-h-screen flex flex-col font-sans selection:bg-white/20">
      <TopNavBar />
      
      <main className="flex-grow w-full max-w-[1024px] mx-auto px-6 py-12 flex flex-col gap-12 pt-24 pb-20">
        
        <header className="flex flex-col gap-4 relative">
            <h1 className="font-display text-[56px] md:text-[72px] text-white leading-none tracking-tight">Аккаунт</h1>
            <p className="font-mono text-[10px] text-white/30 uppercase tracking-[0.2em] font-bold">Управление вашим профилем и безопасностью</p>
        </header>

        {/* Profile Card */}
        <section className="lovable-glass-strong rounded-[2.5rem] p-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-8 relative overflow-hidden group border border-white/5 bg-gradient-to-br from-white/[0.04] to-transparent shadow-[0_0_80px_-20px_rgba(255,255,255,0.05)]">
          <div className="flex items-center gap-10 relative z-10 w-full md:w-auto">
            <div className="w-24 h-24 rounded-[2rem] border border-white/10 bg-white/5 flex items-center justify-center shrink-0">
               <User className="w-12 h-12 text-white/20" />
            </div>
            
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-5 flex-wrap">
                <h2 className="font-display text-4xl text-white leading-none">{user?.name || "Пользователь"}</h2>
                {isEmailVerified && (
                  <span className="bg-white text-black font-mono text-[10px] font-bold uppercase tracking-[0.15em] px-4 py-1.5 rounded-full flex items-center gap-2 shadow-lg shadow-white/5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Подтвержден
                  </span>
                )}
                {isEmailUnverified && (
                  <span className="bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono text-[10px] font-bold uppercase tracking-[0.15em] px-4 py-1.5 rounded-full">
                    Не подтвержден
                  </span>
                )}
              </div>
              
              <div className="flex items-center gap-5 text-white/30 font-mono text-[11px] font-bold uppercase tracking-[0.15em]">
                <span>ID: {user?.id}</span>
                <span className="w-1 h-1 rounded-full bg-white/10"></span>
                <span className="truncate max-w-[200px] sm:max-w-none text-white/60">{user?.email || "Email не указан"}</span>
              </div>
              
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="bg-white/5 border border-white/10 text-white/40 font-mono text-[10px] font-bold uppercase tracking-[0.15em] px-4 py-1.5 rounded-full">Тариф: {subscriptionLabel}</span>
                {user?.is_admin && (
                  <span className="bg-white/10 border border-white/20 text-white font-mono text-[10px] font-bold uppercase tracking-[0.15em] px-4 py-1.5 rounded-full">Администратор</span>
                )}
              </div>
            </div>
          </div>
          
          <button 
            onClick={handleLogout}
            className="relative z-10 w-full md:w-auto flex items-center justify-center gap-3 px-8 py-3.5 bg-white/5 border border-white/10 text-white/60 font-mono text-[11px] font-bold uppercase tracking-[0.2em] rounded-full hover:bg-white hover:text-black hover:border-white transition-all active:scale-[0.98]"
          >
            <LogOut className="w-4 h-4" />
            Выйти
          </button>
        </section>

        {/* Email Verification Actions */}
        {(isEmailMissing || isEmailUnverified) && (
          <section className="bg-amber-500/5 border border-amber-500/10 rounded p-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-sm text-amber-200/70">
                {isEmailMissing ? "Добавьте email, чтобы обезопасить аккаунт." : "Подтвердите email, чтобы получить полный доступ к функциям платформы."}
              </p>
              {isEmailMissing && (
                <button 
                  onClick={() => setIsAddEmailOpen(true)}
                  className="bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 font-mono-label text-[12px] uppercase tracking-widest px-4 py-2 rounded transition-colors whitespace-nowrap"
                >
                  Добавить Email
                </button>
              )}
              {isEmailUnverified && (
                <button 
                  onClick={handleResendVerification}
                  disabled={isResending}
                  className="bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50 font-mono-label text-[12px] uppercase tracking-widest px-4 py-2 rounded transition-colors whitespace-nowrap"
                >
                  {isResending ? "Отправка..." : "Отправить код"}
                </button>
              )}
            </div>
          </section>
        )}

        {/* Security Section */}
        <section className="flex flex-col gap-8">
          <h3 className="font-display text-[28px] font-medium text-white flex items-center gap-3 border-b border-white/10 pb-6">
            <Shield className="w-6 h-6 text-neutral-400" />
            Безопасность
          </h3>
          
          <div className="flex flex-col border border-white/10 rounded-2xl bg-[#111111] overflow-hidden relative border-white/5 bg-black/40">
            {/* Email Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-10 border-b border-white/5 gap-6 hover:bg-white/[0.02] transition-all duration-500 relative z-10 group/row">
              <div className="flex flex-col gap-3">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/20">Email адрес</span>
                <span className="text-xl text-white font-light">{user?.email || "Не указан"}</span>
              </div>
              <button 
                onClick={() => setIsChangeEmailOpen(true)}
                className="self-start sm:self-center px-8 py-3 bg-white/5 border border-white/10 text-white/60 font-mono text-[11px] font-bold uppercase tracking-[0.2em] rounded-full hover:bg-white hover:text-black hover:border-white transition-all active:scale-[0.98]"
              >
                Изменить
              </button>
            </div>
            
            {/* Password Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-10 gap-6 hover:bg-white/[0.02] transition-all duration-500 relative z-10 group/row">
              <div className="flex flex-col gap-3">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/20">Безопасность</span>
                <span className="text-xl text-white font-light">Обновить пароль</span>
                <p className="text-white/20 text-xs font-light">Рекомендуется менять пароль каждые 3 месяца</p>
              </div>
              <button 
                onClick={() => setIsChangePasswordOpen(true)}
                className="self-start sm:self-center px-8 py-3 bg-white/5 border border-white/10 text-white/60 font-mono text-[11px] font-bold uppercase tracking-[0.2em] rounded-full hover:bg-white hover:text-black hover:border-white transition-all active:scale-[0.98]"
              >
                Изменить
              </button>
            </div>
          </div>
        </section>

      </main>

      {/* MODALS */}
      
      {/* Add Email Modal */}
      {isAddEmailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#111111] border border-white/10 rounded w-full max-w-md p-6">
            <h3 className="text-xl font-display font-medium text-white mb-6">Добавить Email</h3>
            <input
              type="email"
              placeholder="user@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="bg-[#0A0A0A] border border-white/[0.08] text-white rounded p-3 font-code text-[13px] w-full h-11 focus:outline-none focus:border-white/40 transition-colors mb-6"
            />
            <div className="flex justify-end gap-3">
              <button className="px-4 py-2 font-mono-label text-[12px] uppercase tracking-widest text-neutral-400 hover:text-white transition-colors" onClick={() => setIsAddEmailOpen(false)}>Отмена</button>
              <button className="px-4 py-2 bg-white text-black font-mono-label text-[12px] uppercase tracking-widest rounded hover:opacity-90 transition-opacity" onClick={handleAddEmail}>Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {isChangePasswordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#111111] border border-white/10 rounded w-full max-w-md p-6">
            <h3 className="text-xl font-display font-medium text-white mb-6">Сменить пароль</h3>

            {passwordStep === "init" && (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="font-mono-label text-[11px] uppercase tracking-widest text-neutral-400 mb-2 block">Текущий пароль</label>
                    <input
                      type="password"
                      value={passwordForm.current}
                      onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                      className="bg-[#0A0A0A] border border-white/[0.08] text-white rounded p-3 font-code text-[13px] w-full h-11 focus:outline-none focus:border-white/40 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="font-mono-label text-[11px] uppercase tracking-widest text-neutral-400 mb-2 block">Новый пароль</label>
                    <input
                      type="password"
                      value={passwordForm.new}
                      onChange={(e) => setPasswordForm({ ...passwordForm, new: e.target.value })}
                      className="bg-[#0A0A0A] border border-white/[0.08] text-white rounded p-3 font-code text-[13px] w-full h-11 focus:outline-none focus:border-white/40 transition-colors"
                    />
                    <p className="text-[11px] text-white/30 mt-2 font-mono-label uppercase tracking-widest">Минимум 8 символов</p>
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-8">
                  <button className="px-4 py-2 font-mono-label text-[12px] uppercase tracking-widest text-neutral-400 hover:text-white transition-colors" onClick={() => setIsChangePasswordOpen(false)}>Отмена</button>
                  <button className="px-4 py-2 bg-white text-black font-mono-label text-[12px] uppercase tracking-widest rounded hover:opacity-90 transition-opacity" onClick={handleInitiateChangePassword}>Далее</button>
                </div>
              </>
            )}

            {passwordStep === "confirm" && (
              <>
                <p className="text-neutral-400 text-sm mb-6 leading-relaxed">
                  Мы отправили код подтверждения на <b>{user?.email}</b>.
                  Введите его ниже для подтверждения смены пароля.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="font-mono-label text-[11px] uppercase tracking-widest text-neutral-400 mb-2 block">Код из письма</label>
                    <input
                      type="text"
                      placeholder="123456"
                      value={passwordForm.code}
                      onChange={(e) => setPasswordForm({ ...passwordForm, code: e.target.value })}
                      className="bg-[#0A0A0A] border border-white/[0.08] text-white rounded p-3 font-code text-[18px] w-full h-12 focus:outline-none focus:border-white/40 transition-colors text-center tracking-[0.5em]"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-8">
                  <button className="px-4 py-2 font-mono-label text-[12px] uppercase tracking-widest text-neutral-400 hover:text-white transition-colors" onClick={() => setPasswordStep("init")}>Назад</button>
                  <button className="px-4 py-2 bg-white text-black font-mono-label text-[12px] uppercase tracking-widest rounded hover:opacity-90 transition-opacity" onClick={handleConfirmChangePassword}>Подтвердить</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Change Email Modal */}
      {isChangeEmailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#111111] border border-white/10 rounded w-full max-w-md p-6 overflow-hidden relative">
            <motion.div layout>
              <motion.h3 layout="position" className="text-xl font-display font-medium text-white mb-6">Сменить Email</motion.h3>

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
                        <label className="font-mono-label text-[11px] uppercase tracking-widest text-neutral-400 mb-2 block">Новая почта</label>
                        <input
                          type="email"
                          placeholder="new@example.com"
                          value={emailForm.new}
                          onChange={(e) => setEmailForm({ ...emailForm, new: e.target.value })}
                          className="bg-[#0A0A0A] border border-white/[0.08] text-white rounded p-3 font-code text-[13px] w-full h-11 focus:outline-none focus:border-white/40 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="font-mono-label text-[11px] uppercase tracking-widest text-neutral-400 mb-2 block">Подтверждение почты</label>
                        <input
                          type="email"
                          placeholder="new@example.com"
                          value={emailForm.confirm}
                          onChange={(e) => setEmailForm({ ...emailForm, confirm: e.target.value })}
                          className="bg-[#0A0A0A] border border-white/[0.08] text-white rounded p-3 font-code text-[13px] w-full h-11 focus:outline-none focus:border-white/40 transition-colors"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 mt-8">
                      <button className="px-4 py-2 font-mono-label text-[12px] uppercase tracking-widest text-neutral-400 hover:text-white transition-colors" onClick={() => { setIsChangeEmailOpen(false); setEmailForm({ new: "", confirm: "", code: "" }); }}>Отмена</button>
                      <button className="px-4 py-2 bg-white text-black font-mono-label text-[12px] uppercase tracking-widest rounded hover:opacity-90 transition-opacity" onClick={handleInitiateChangeEmail}>Далее</button>
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
                    <p className="text-neutral-400 text-sm mb-6 leading-relaxed">
                      Мы отправили код подтверждения на <b>{emailForm.new}</b>.
                      Введите его ниже для подтверждения смены почты.
                    </p>
                    <div className="space-y-4">
                      <div>
                        <label className="font-mono-label text-[11px] uppercase tracking-widest text-neutral-400 mb-2 block">Код подтверждения</label>
                        <input
                          type="text"
                          placeholder="123456"
                          value={emailForm.code}
                          onChange={(e) => setEmailForm({ ...emailForm, code: e.target.value })}
                          className="bg-[#0A0A0A] border border-white/[0.08] text-white rounded p-3 font-code text-[18px] w-full h-12 focus:outline-none focus:border-white/40 transition-colors text-center tracking-[0.5em]"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 mt-8">
                      <button className="px-4 py-2 font-mono-label text-[12px] uppercase tracking-widest text-neutral-400 hover:text-white transition-colors" onClick={() => setEmailStep("init")}>Назад</button>
                      <button className="px-4 py-2 bg-white text-black font-mono-label text-[12px] uppercase tracking-widest rounded hover:opacity-90 transition-opacity" onClick={handleConfirmChangeEmail}>Подтвердить</button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      )}

      {/* Email Sent Confirmation Modal */}
      {showEmailSentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#111111] border border-white/10 rounded w-full max-w-sm p-8 text-center">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
                <Check className="w-8 h-8 text-white" />
              </div>
            </div>
            <h3 className="text-xl font-display font-medium text-white mb-3">Письмо отправлено</h3>
            <p className="text-neutral-400 text-sm mb-8 leading-relaxed">
              Мы отправили ссылку для подтверждения на вашу почту.
              <br /><br />
              <span className="text-white/30 text-[11px] font-mono-label uppercase tracking-widest">
                Если письма нет во входящих, проверьте папку Спам.
              </span>
            </p>
            <button className="w-full px-4 py-3 bg-white text-black font-mono-label text-[12px] uppercase tracking-widest rounded hover:opacity-90 transition-opacity" onClick={() => setShowEmailSentModal(false)}>
              Понятно
            </button>
          </div>
        </div>
      )}

      <SiteFooter />
    </div>
  );
}
