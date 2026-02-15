"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, MapPin, Clock, Send } from "lucide-react";
import Layout from "@/components/Layout";

const contactInfo = [
    { icon: Mail, label: "Email", value: "hello@pitchy.pro" },
    { icon: MapPin, label: "Адрес", value: "Москва, Россия" },
    { icon: Clock, label: "Время ответа", value: "В течение 24 часов" },
];

export default function ContactPage() {
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        subject: "",
        message: "",
    });
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitted(true);
        setTimeout(() => setSubmitted(false), 3000);
        setFormData({ name: "", email: "", subject: "", message: "" });
    };

    return (
        <Layout>
            <div className="min-h-screen pt-24 pb-16 px-4 sm:px-6 lg:px-8">
                <div className="max-w-5xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center mb-12"
                    >
                        <div className="flex justify-center mb-4">
                            <div className="w-14 h-14 rounded-2xl bg-pitchy-violet/10 border border-pitchy-violet/20 flex items-center justify-center">
                                <Mail className="w-7 h-7 text-pitchy-violet" />
                            </div>
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
                            Свяжитесь с нами
                        </h1>
                        <p className="text-white/50 text-lg">
                            Будем рады ответить на ваши вопросы
                        </p>
                    </motion.div>

                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                        {/* Contact Info */}
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.2 }}
                            className="lg:col-span-2 space-y-4"
                        >
                            {contactInfo.map((item, i) => (
                                <div key={i} className="glass-card-hover p-5 flex items-start gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-pitchy-violet/10 flex items-center justify-center flex-shrink-0">
                                        <item.icon className="w-5 h-5 text-pitchy-violet" />
                                    </div>
                                    <div>
                                        <p className="text-sm text-white/40 mb-0.5">{item.label}</p>
                                        <p className="text-white font-medium">{item.value}</p>
                                    </div>
                                </div>
                            ))}
                        </motion.div>

                        {/* Form */}
                        <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.3 }}
                            className="lg:col-span-3"
                        >
                            <div className="glass-panel rounded-3xl p-6 sm:p-8">
                                <form onSubmit={handleSubmit} className="space-y-5">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-white/70 mb-2">
                                                Имя
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.name}
                                                onChange={(e) =>
                                                    setFormData({ ...formData, name: e.target.value })
                                                }
                                                className="pitchy-input"
                                                placeholder="Ваше имя"
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-white/70 mb-2">
                                                Email
                                            </label>
                                            <input
                                                type="email"
                                                value={formData.email}
                                                onChange={(e) =>
                                                    setFormData({ ...formData, email: e.target.value })
                                                }
                                                className="pitchy-input"
                                                placeholder="you@example.com"
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-white/70 mb-2">
                                            Тема
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.subject}
                                            onChange={(e) =>
                                                setFormData({ ...formData, subject: e.target.value })
                                            }
                                            className="pitchy-input"
                                            placeholder="О чём хотите написать?"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-white/70 mb-2">
                                            Сообщение
                                        </label>
                                        <textarea
                                            value={formData.message}
                                            onChange={(e) =>
                                                setFormData({ ...formData, message: e.target.value })
                                            }
                                            className="pitchy-input min-h-[120px] resize-none"
                                            placeholder="Расскажите подробнее..."
                                            required
                                        />
                                    </div>

                                    <motion.button
                                        type="submit"
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        className="w-full btn-primary py-3 rounded-xl cursor-pointer"
                                    >
                                        {submitted ? (
                                            <span className="flex items-center justify-center gap-2">
                                                ✓ Отправлено!
                                            </span>
                                        ) : (
                                            <span className="flex items-center justify-center gap-2">
                                                <Send className="w-4 h-4" />
                                                Отправить
                                            </span>
                                        )}
                                    </motion.button>
                                </form>
                            </div>
                        </motion.div>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
