"use client";

import { useState } from "react";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";
import { MapPin, Clock, ArrowRight, CheckCircle2 } from "lucide-react";

export default function ContactPage() {
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        user_id: "",
        subject: "",
        message: "",
    });
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitted(true);
        setTimeout(() => setSubmitted(false), 3000);
        setFormData({ name: "", email: "", user_id: "", subject: "", message: "" });
    };

    return (
        <div className="bg-[#0A0A0A] text-white antialiased min-h-screen flex flex-col font-body-lg">
            <TopNavBar />
            
            <main className="flex-grow pt-24 pb-12 px-6 md:px-6 max-w-[1440px] mx-auto w-full flex flex-col gap-12">
                {/* Header Section */}
                <div className="flex flex-col gap-4 w-full max-w-3xl mt-8 md:mt-16">
                    <h1 className="font-display text-[48px] leading-[1.1] tracking-[-0.02em] font-semibold text-white">Связь с нами.</h1>
                    <p className="text-lg text-neutral-400 w-full max-w-2xl leading-relaxed">
                        Используйте форму ниже для технических запросов, вопросов по интеграции или поддержки. Мы стремимся к максимальной эффективности коммуникации.
                    </p>
                </div>

                {/* Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start pb-16">
                    {/* Contact Info Panel (Left) */}
                    <div className="lg:col-span-4 flex flex-col gap-4">
                        {/* Info Card */}
                        <div className="bg-[#111111] p-6 border border-white/[0.08] rounded flex flex-col gap-6 relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.06] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                            
                            <div className="flex flex-col gap-1 relative z-10">
                                <span className="font-mono-label text-[12px] text-[#444444] uppercase tracking-widest mb-1">Email</span>
                                <a className="font-h2 text-[24px] font-medium text-white hover:text-white/80 transition-colors" href="mailto:auth@pitchy.pro">auth@pitchy.pro</a>
                            </div>
                            
                            <div className="w-full h-px bg-white/[0.08] relative z-10"></div>
                            
                            <div className="flex flex-col gap-1 relative z-10">
                                <span className="font-mono-label text-[12px] text-[#444444] uppercase tracking-widest mb-1">Локация</span>
                                <div className="flex items-start gap-2">
                                    <MapPin className="text-neutral-400 w-5 h-5 mt-1" />
                                    <span className="font-body-lg text-white">Москва,<br/>Россия</span>
                                </div>
                            </div>
                            
                            <div className="w-full h-px bg-white/[0.08] relative z-10"></div>
                            
                            <div className="flex flex-col gap-1 relative z-10">
                                <span className="font-mono-label text-[12px] text-[#444444] uppercase tracking-widest mb-1">SLA Поддержки</span>
                                <div className="flex items-center gap-2">
                                    <Clock className="text-neutral-400 w-5 h-5" />
                                    <span className="font-code text-[13px] text-white">Время ответа: <span className="text-white font-medium">~24 часа</span></span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Form Container (Right) */}
                    <div className="lg:col-span-8 bg-[#111111] p-6 md:p-12 border border-white/[0.08] rounded relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                        
                        <form onSubmit={handleSubmit} className="flex flex-col gap-5 relative z-10">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div className="flex flex-col gap-2">
                                    <label className="font-mono-label text-[12px] text-[#444444] uppercase tracking-widest" htmlFor="name">Имя</label>
                                    <input 
                                        className="bg-[#111111] border border-white/[0.08] text-white rounded p-3 font-code text-[13px] w-full h-11 focus:outline-none focus:border-white/40 transition-colors placeholder:text-[#444444]" 
                                        id="name" 
                                        name="name" 
                                        placeholder="Введите ваше имя" 
                                        type="text"
                                        required
                                        value={formData.name}
                                        onChange={e => setFormData({...formData, name: e.target.value})}
                                    />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <label className="font-mono-label text-[12px] text-[#444444] uppercase tracking-widest" htmlFor="email">Email</label>
                                    <input 
                                        className="bg-[#111111] border border-white/[0.08] text-white rounded p-3 font-code text-[13px] w-full h-11 focus:outline-none focus:border-white/40 transition-colors placeholder:text-[#444444]" 
                                        id="email" 
                                        name="email" 
                                        placeholder="example@domain.com" 
                                        type="email"
                                        required
                                        value={formData.email}
                                        onChange={e => setFormData({...formData, email: e.target.value})}
                                    />
                                </div>
                                <div className="flex flex-col gap-2 md:col-span-2">
                                    <label className="font-mono-label text-[12px] text-[#444444] uppercase tracking-widest" htmlFor="user_id">User ID (Опционально)</label>
                                    <input 
                                        className="bg-[#111111] border border-white/[0.08] text-white rounded p-3 font-code text-[13px] w-full h-11 focus:outline-none focus:border-white/40 transition-colors placeholder:text-[#444444]" 
                                        id="user_id" 
                                        name="user_id" 
                                        placeholder="Введите ваш User ID" 
                                        type="text"
                                        value={formData.user_id}
                                        onChange={e => setFormData({...formData, user_id: e.target.value})}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="font-mono-label text-[12px] text-[#444444] uppercase tracking-widest" htmlFor="subject">Тема</label>
                                <select 
                                    className="bg-[#111111] border border-white/[0.08] text-white rounded px-3 py-0 font-code text-[13px] w-full h-11 focus:outline-none focus:border-white/40 transition-colors cursor-pointer appearance-none" 
                                    style={{backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: `right 0.5rem center`, backgroundRepeat: `no-repeat`, backgroundSize: `1.5em 1.5em`, paddingRight: `2.5rem`}}
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
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="font-mono-label text-[12px] text-[#444444] uppercase tracking-widest" htmlFor="message">Сообщение</label>
                                <textarea 
                                    className="bg-[#111111] border border-white/[0.08] text-white rounded p-3 font-code text-[13px] w-full resize-y min-h-[140px] focus:outline-none focus:border-white/40 transition-colors placeholder:text-[#444444]" 
                                    id="message" 
                                    name="message" 
                                    placeholder="Опишите ваш запрос детально..." 
                                    rows={6}
                                    required
                                    value={formData.message}
                                    onChange={e => setFormData({...formData, message: e.target.value})}
                                ></textarea>
                            </div>

                            <div className="pt-4 flex justify-end">
                                <button 
                                    className={`font-mono-label text-[12px] px-8 py-3 rounded flex items-center gap-2 transition-all ${
                                        submitted 
                                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50" 
                                        : "bg-white text-black hover:opacity-90"
                                    }`} 
                                    type="submit"
                                    disabled={submitted}
                                >
                                    <span>{submitted ? "УСПЕШНО ОТПРАВЛЕНО" : "ОТПРАВИТЬ"}</span>
                                    {submitted ? <CheckCircle2 className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
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
