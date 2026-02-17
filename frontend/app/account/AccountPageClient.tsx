"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMounted } from "@mantine/hooks";
import Layout from "@/components/Layout";
import { GlassCard, Button } from "@/components/shared";
import { clearToken, getToken } from "@/lib/auth";
import { postAuthJson } from "@/lib/api";
import { LogOut, User, Shield, ChevronLeft } from "lucide-react";

export function AccountPageClient() {
  const router = useRouter();
  const mounted = useMounted();
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      const token = getToken();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const data = await postAuthJson<{ name: string; email: string }>("/me", {}, token);
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
                    <p className="text-white/50">{user?.email || "Email не указан"}</p>
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
                <Button variant="secondary" size="sm">Изменить</Button>
              </div>
            </GlassCard>

            <p className="text-center text-xs text-white/20 mt-12">
              Pitchy Pro Account ID: {user ? "Verified" : "Guest"}
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
