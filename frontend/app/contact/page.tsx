"use client";

import { useState } from "react";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";
import { MapPin, Clock, ArrowRight, CheckCircle2, Mail, Send } from "lucide-react";
import { notifyError, notifySuccess } from "@/lib/ui";

export default function ContactPage() {
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        subject: "",
        message: "",
    });
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        try {
            const res = await fetch(`/contact-form`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                const detail = typeof data?.detail === "string"
                    ? data.detail
                    : "Не удалось отправить обращение. Попробуйте позже.";
                notifyError(detail);
                return;
            }
            notifySuccess("Обращение отправлено. Ответим на email в течение 24 часов.");
            setSubmitted(true);
            setFormData({ name: "", email: "", subject: "", message: "" });
            setTimeout(() => setSubmitted(false), 4000);
        } catch {
            notifyError("Не удалось связаться с сервером. Проверьте интернет.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="bg-black text-foreground antialiased min-h-screen flex flex-col relative overflow-hidden">
             {/* Decorative Orbs */}
             <div className="aurora-orb top-[-10rem] right-[-10rem] h-96 w-96 bg-white/[0.03] animate-pulse" />
             <div className="aurora-orb bottom-[-5rem] left-[-5rem] h-80 w-80 bg-white/[0.02] animate-float-slow" />

            <TopNavBar />
            
            <main className="flex-grow pt-12 pb-24 px-6 md:px-12 max-w-[1440px] mx-auto w-full relative z-10">
                {/* Header Section */}
                <header className="mb-20 mt-8">
                    <h1 className="font-display text-4xl sm:text-6xl md:text-8xl text-white mb-8 tracking-tighter leading-none">
                        Связь с <span className="text-white/30 italic">нами</span>.
                    </h1>
                    <p className="text-xl text-foreground/60 w-full max-w-2xl leading-relaxed">
                        Используйте форму ниже для технических запросов, вопросов по интеграции или поддержки. Мы ответим в течение 24 часов.
                    </p>
                </header>

                {/* Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start pb-16">
                    {/* Contact Info Panel (Left) */}
                    <div className="lg:col-span-4 flex flex-col gap-6">
                        <div className="lovable-glass p-5 sm:p-8 lg:p-10 rounded-3xl sm:rounded-[40px] flex flex-col gap-8 sm:gap-10 relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.06] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
                            
                            <div className="flex flex-col gap-4 relative z-10">
                                <span className="font-mono-label text-[11px] text-white/30 uppercase tracking-[0.3em]">Email</span>
                                <a className="font-display text-3xl text-white hover:text-white/70 transition-colors tracking-tight" href="mailto:support@pitchy.pro">support@pitchy.pro</a>
                            </div>
                            
                            <div className="w-full h-px bg-white/5 relative z-10"></div>
                            
                            <div className="flex flex-col gap-4 relative z-10">
                                <span className="font-mono-label text-[11px] text-white/30 uppercase tracking-[0.3em]">Локация</span>
                                <div className="flex items-start gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center border border-white/10 shrink-0">
                                        <MapPin size={18} className="text-white/60" />
                                    </div>
                                    <span className="font-display text-2xl text-white leading-snug tracking-tight">Москва,<br/>Россия</span>
                                </div>
                            </div>
                            
                            <div className="w-full h-px bg-white/5 relative z-10"></div>
                            
                            <div className="flex flex-col gap-4 relative z-10">
                                <span className="font-mono-label text-[11px] text-white/30 uppercase tracking-[0.3em]">SLA Поддержки</span>
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center border border-white/10 shrink-0">
                                        <Clock size={18} className="text-white/60" />
                                    </div>
                                    <span className="font-body-sm text-lg text-white/80 tracking-tight">Время ответа: <span className="text-white font-bold">~24 часа</span></span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Form Container (Right) */}
                    <div className="lg:col-span-8 lovable-glass p-5 sm:p-8 md:p-16 rounded-3xl sm:rounded-[40px] relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
                        
                        <form onSubmit={handleSubmit} className="flex flex-col gap-8 relative z-10">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="flex flex-col gap-3">
                                    <label className="font-mono-label text-[11px] text-white/40 uppercase tracking-[0.2em] ml-1" htmlFor="name">Имя</label>
                                    <input 
                                        className="bg-white/5 border border-white/10 text-white rounded-2xl px-6 py-4 font-body-sm text-[16px] w-full focus:outline-none focus:border-white/30 transition-all placeholder:text-white/20" 
                                        id="name" 
                                        name="name" 
                                        placeholder="Введите ваше имя" 
                                        type="text"
                                        required
                                        value={formData.name}
                                        onChange={e => setFormData({...formData, name: e.target.value})}
                                    />
                                </div>
                                <div className="flex flex-col gap-3">
                                    <label className="font-mono-label text-[11px] text-white/40 uppercase tracking-[0.2em] ml-1" htmlFor="email">Email</label>
                                    <input 
                                        className="bg-white/5 border border-white/10 text-white rounded-2xl px-6 py-4 font-body-sm text-[16px] w-full focus:outline-none focus:border-white/30 transition-all placeholder:text-white/20" 
                                        id="email" 
                                        name="email" 
                                        placeholder="example@domain.com" 
                                        type="email"
                                        required
                                        value={formData.email}
                                        onChange={e => setFormData({...formData, email: e.target.value})}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-3">
                                <label className="font-mono-label text-[11px] text-white/40 uppercase tracking-[0.2em] ml-1" htmlFor="subject">Тема</label>
                                <div className="relative">
                                    <select 
                                        className="bg-white/5 border border-white/10 text-white rounded-2xl px-6 py-4 font-body-sm text-[16px] w-full focus:outline-none focus:border-white/30 transition-all cursor-pointer appearance-none" 
                                        id="subject" 
                                        name="subject"
                                        required
                                        value={formData.subject}
                                        onChange={e => setFormData({...formData, subject: e.target.value})}
                                    >
                                        <option disabled value="">Выберите тему обращения</option>
                                        <option value="tech">Техническая поддержка</option>
                                        <option value="billing">Вопросы оплаты</option>
                                        <option value="api">Интеграция API</option>
                                        <option value="other">Другое</option>
                                    </select>
                                    <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-white/30">
                                        <ArrowRight size={16} className="rotate-90" />
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-3">
                                <label className="font-mono-label text-[11px] text-white/40 uppercase tracking-[0.2em] ml-1" htmlFor="message">Сообщение</label>
                                <textarea 
                                    className="bg-white/5 border border-white/10 text-white rounded-2xl px-6 py-4 font-body-sm text-[16px] w-full resize-y min-h-[160px] focus:outline-none focus:border-white/30 transition-all placeholder:text-white/20" 
                                    id="message" 
                                    name="message" 
                                    placeholder="Опишите ваш запрос детально..." 
                                    rows={6}
                                    required
                                    value={formData.message}
                                    onChange={e => setFormData({...formData, message: e.target.value})}
                                ></textarea>
                            </div>

                            <div className="pt-4">
                                <button
                                    className={`w-full py-5 rounded-2xl font-mono-label text-[12px] uppercase tracking-[0.3em] font-black flex items-center justify-center gap-3 transition-all duration-500 ${
                                        submitted
                                        ? "bg-emerald-500 text-white shadow-[0_0_40px_rgba(16,185,129,0.3)]"
                                        : "bg-white text-black hover:scale-[1.02] active:scale-[0.98] shadow-2xl disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                                    }`}
                                    type="submit"
                                    disabled={submitting || submitted}
                                >
                                    <span>{submitted ? "УСПЕШНО ОТПРАВЛЕНО" : submitting ? "ОТПРАВКА…" : "ОТПРАВИТЬ ЗАПРОС"}</span>
                                    {submitted ? <CheckCircle2 size={18} /> : <ArrowRight size={18} />}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </main>
            
            <SiteFooter />
        </div>
    );
}
