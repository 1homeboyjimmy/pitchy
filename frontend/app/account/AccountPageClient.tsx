"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMounted } from "@mantine/hooks";
import Layout from "@/components/Layout";
import { GlassCard, Button } from "@/components/shared";
import { clearToken, getToken } from "@/lib/auth";
import { postAuthJson } from "@/lib/api";
import { LogOut, User, Shield, ChevronLeft } from "lucide-react";

interface UserProfile {
  id: number;
  name: string;
  email: string;
  email_verified: boolean;
}

export function AccountPageClient() {
  const router = useRouter();
  const mounted = useMounted();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [isAddEmailOpen, setIsAddEmailOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  // Form states
  const [emailInput, setEmailInput] = useState("");
  const [passwordForm, setPasswordForm] = useState({ current: "", new: "" });
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
        alert("Письмо отправлено!");
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
        alert("Email добавлен! Проверьте почту для подтверждения.");
        setIsAddEmailOpen(false);
        // Refresh user data
        const data = await postAuthJson<UserProfile>("/me", {}, token);
        setUser(data);
      }
    } catch (e) {
      console.error(e);
      alert("Ошибка добавления email");
    }
  };

  const handleChangePassword = async () => {
    try {
      const token = getToken();
      if (token) {
        await postAuthJson("/auth/change-password", {
          current_password: passwordForm.current,
          new_password: passwordForm.new
        }, token);
        alert("Пароль успешно изменен!");
        setIsChangePasswordOpen(false);
        setPasswordForm({ current: "", new: "" });
      }
    } catch (e) {
      console.error(e);
      alert("Ошибка смены пароля. Проверьте текущий пароль.");
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
                {!user?.email && (
                  <Button size="sm" variant="secondary" onClick={() => setIsAddEmailOpen(true)}>
                    Добавить Email
                  </Button>
                )}
                {user?.email && !user?.email_verified && (
                  <Button size="sm" variant="secondary" onClick={handleResendVerification} disabled={isResending}>
                    {isResending ? "Отправка..." : "Подтвердить Email"}
                  </Button>
                )}
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

            <p className="text-center text-xs text-white/20 mt-12">
              Pitchy Pro Account ID: {user?.id} ({user?.email ? "Verified" : "Guest"})
            </p>
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

      {/* Change Password Modal */}
      {isChangePasswordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <GlassCard className="w-full max-w-md p-6" hover={false}>
            <h3 className="text-xl font-bold text-white mb-4">Сменить пароль</h3>
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
                <p className="text-xs text-white/30 mt-1">Минимум 8 символов, буквы и цифры</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => setIsChangePasswordOpen(false)}>Отмена</Button>
              <Button variant="primary" onClick={handleChangePassword}>Сменить</Button>
            </div>
          </GlassCard>
        </div>
      )}
    </Layout>
  );
}
