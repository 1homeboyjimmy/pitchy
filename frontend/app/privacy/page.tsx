"use client";

import { motion } from "framer-motion";
import { Shield, Eye, Lock, Database, UserCheck, Bell } from "lucide-react";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";
import { PitchyLogo } from "@/components/shared/PitchyLogo";

const sections = [
    {
        icon: Eye,
        title: "1. Сбор информации",
        content:
            "Мы собираем информацию, которую вы предоставляете при создании аккаунта (email, имя), а также данные об использовании платформы (анализы, запросы). Мы не собираем конфиденциальную финансовую информацию о стартапах.",
    },
    {
        icon: UserCheck,
        title: "2. Использование данных",
        content:
            "Ваши данные используются для: предоставления сервиса, улучшения алгоритмов анализа, отправки уведомлений (при согласии), и обеспечения безопасности аккаунта. Мы не продаём ваши данные третьим лицам.",
    },
    {
        icon: Lock,
        title: "3. Хранение данных",
        content:
            "Данные хранятся на защищённых серверах с шифрованием. Мы храним данные только на территории Российской Федерации в соответствии с требованиями 152-ФЗ.",
    },
    {
        icon: Database,
        title: "4. Права пользователей",
        content:
            "Вы имеете право: запрашивать копию своих данных, требовать удаления данных, отзывать согласие на обработку, подавать жалобу в надзорный орган.",
    },
    {
        icon: Bell,
        title: "5. Cookies",
        content:
            "Мы используем необходимые cookies для работы платформы и аналитические cookies для улучшения сервиса. Вы можете управлять cookies в настройках браузера.",
    },
    {
        icon: Shield,
        title: "6. Контакты",
        content:
            "По вопросам конфиденциальности: auth@pitchy.pro. Ответственный за обработку персональных данных: указан в реквизитах компании.",
    },
];

export default function PrivacyPage() {
    return (
        <div className="bg-black text-foreground antialiased min-h-screen flex flex-col relative overflow-hidden">
            {/* Decorative Orbs */}
            <div className="aurora-orb top-[-10rem] right-[-5rem] h-96 w-96 bg-white/[0.03] animate-pulse" />
            
            <TopNavBar />

            <main className="flex-grow pt-32 pb-24 px-6 md:px-12 max-w-[1440px] mx-auto w-full relative z-10">
                <div className="max-w-4xl mx-auto">
                    {/* Header */}
                    <header className="mb-16 md:mb-24 mt-8 md:mt-16 text-center">
                        <h1 className="font-display text-5xl md:text-7xl text-white mb-8 tracking-tighter leading-none">
                            Конфиденциальность<span className="text-white/20">.</span>
                        </h1>
                        <p className="font-body-lg text-xl text-foreground/60 max-w-2xl mx-auto leading-relaxed">
                            Мы уважаем вашу приватность и обеспечиваем полную прозрачность в обработке персональных данных.
                        </p>
                    </header>

                    {/* Quick Summary Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20">
                        {sections.map((section, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.05 }}
                                className="lovable-glass rounded-3xl p-8 hover:translate-y-[-4px] transition-all duration-500 group"
                            >
                                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                    <section.icon className="w-5 h-5 text-white/40" />
                                </div>
                                <h2 className="font-display text-lg font-bold text-white mb-4 uppercase tracking-tight">
                                    {section.title}
                                </h2>
                                <p className="font-body-sm text-foreground/50 leading-relaxed">
                                    {section.content}
                                </p>
                            </motion.div>
                        ))}
                    </div>

                    {/* Detailed Legal Appendix */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="lovable-glass-strong rounded-[40px] p-10 md:p-16"
                    >
                        <div className="prose prose-invert prose-neutral max-w-none prose-p:text-foreground/70 prose-headings:text-white prose-li:text-foreground/70">
                        <h2 className="text-3xl font-display mb-10 tracking-tight">Полный текст Политики в отношении обработки персональных данных</h2>
                            
                            <h3 className="text-xl mt-12 mb-6 uppercase tracking-wider font-bold font-display">1. ОБЩИЕ ПОЛОЖЕНИЯ</h3>
                            <p>1.1. Настоящая политика Самозанятого Фигурняк Егора Сергеевича (ИНН 400700088347) (далее – «Оператор») в отношении обработки персональных данных (далее – «Политика») определяет порядок обработки персональных данных.</p>
                            <p>1.2. Настоящая Политика разработана во исполнение требований п. 2 ч. 1 ст. 18.1 Федерального закона от 27.07.2006 N 152-ФЗ «О персональных данных».</p>

                            <h3 className="text-xl mt-12 mb-6 uppercase tracking-wider font-bold font-display">2. ОБЪЕМ И КАТЕГОРИИ ДАННЫХ</h3>
                            <p>2.1. Оператор может обрабатывать персональные данные следующих субъектов: посетители сайта <PitchyLogo size="none" /> (далее – «Сайт»), клиенты Оператора.</p>
                            <p>2.2. К персональным данным, обрабатываемым Оператором, относятся: имя; адрес электронной почты; поисковые запросы на Сайте Оператора.</p>
                            <p>2.3. Обработка специальных категорий персональных данных, касающихся расовой, национальной принадлежности, политических взглядов, религиозных или философских убеждений, интимной жизни, Оператором не осуществляется.</p>

                            <h3 className="text-xl mt-12 mb-6 uppercase tracking-wider font-bold font-display">3. ЦЕЛИ СБОРА ДАННЫХ</h3>
                            <p>3.1. Персональные данные обрабатываются Оператором в целях: предоставления доступа к функционалу Сайта; подготовки, заключения и исполнения гражданско-правового договора (оферты).</p>

                            <h3 className="text-xl mt-12 mb-6 uppercase tracking-wider font-bold font-display">4. ПОРЯДОК И УСЛОВИЯ ОБРАБОТКИ</h3>
                            <p>4.1. Обработка осуществляется автоматизированным способом с передачей по сети Интернет.</p>
                            <p>4.2. Обработка персональных данных осуществляется Оператором при условии получения согласия субъекта. Согласие дается путем акцепта Оферты при регистрации на Сайте или совершения конклюдентных действий на Сайте.</p>
                            <p>4.3. Хранение персональных данных осуществляется в форме, позволяющей определить субъекта персональных данных, в течение срока не дольше, чем этого требуют цели обработки. При осуществлении хранения Оператор использует базы данных и сервера, находящиеся на территории Российской Федерации.</p>

                            <h3 className="text-xl mt-12 mb-6 uppercase tracking-wider font-bold font-display">5. ИЗМЕНЕНИЕ И УНИЧТОЖЕНИЕ</h3>
                            <p>5.1. По письменному запросу (на email: auth@pitchy.pro) субъект персональных данных вправе требовать от Оператора уточнения его персональных данных, их блокирования или уничтожения.</p>

                            <div className="mt-16 pt-8 border-t border-white/10">
                                <p className="font-sans text-[11px] text-white/30 uppercase tracking-widest italic">
                                    Дата последнего обновления: февраль 2026 года.
                                </p>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </main>

            <SiteFooter />
        </div>
    );
}
