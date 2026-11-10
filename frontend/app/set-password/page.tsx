"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { postJson } from "@/lib/api";

export default function SetInvitationPassword() {
  const [email, setEmail] = useState(""); const [token, setToken] = useState("");
  const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    setEmail(params.get("email") || ""); setToken(params.get("token") || "");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (password !== confirmation) { setError("Пароли не совпадают"); return; }
    setBusy(true);
    try { await postJson("/auth/set-invitation-password", { email, token, new_password: password }); setDone(true); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось установить пароль"); }
    finally { setBusy(false); }
  };
  return <main className="grid min-h-screen place-items-center bg-black p-5 text-white"><section className="workspace-card w-full max-w-lg"><h1 className="text-2xl">Акселератор РТУ МИРЭА</h1><p className="my-4 text-white/65">{done ? "Пароль установлен. Войдите и завершите регистрацию участника." : "Установите пароль, чтобы завершить регистрацию в преакселераторе."}</p>{done ? <Link className="workspace-button" href="/login?next=/accelerator">Войти</Link> : token && email ? <form onSubmit={submit} className="space-y-4"><p>{email}</p><label className="block">Новый пароль<input autoComplete="new-password" type="password" required minLength={8} maxLength={72} className="workspace-input mt-2" value={password} onChange={e => setPassword(e.target.value)} /></label><p className="text-xs text-white/50">От 8 до 72 символов, буквы и цифры.</p><label className="block">Повторите пароль<input autoComplete="new-password" type="password" required className="workspace-input mt-2" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>{error && <p role="alert" className="text-red-200">{error}</p>}<button disabled={busy} className="workspace-button">{busy ? "Сохраняем…" : "Установить пароль"}</button></form> : <Link href="/forgot-password" className="workspace-button">Запросить восстановление пароля</Link>}</section></main>;
}
