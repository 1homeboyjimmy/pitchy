"use client";
import { useAuth } from "@/lib/hooks/useAuth";
export function SessionStatus() {
  const { authError, retryAuth } = useAuth();
  if (!authError) return null;
  return <div role="alert" className="fixed inset-x-4 top-4 z-[9999] mx-auto max-w-xl rounded-xl border border-red-300 bg-white p-4 text-gray-900 shadow-lg">Не удалось проверить вход. Данные аккаунта не загружены.<button className="ml-3 underline" onClick={() => void retryAuth()}>Повторить загрузку</button></div>;
}
