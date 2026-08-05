"use client";

import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";
import { motion } from "framer-motion";
import { PitchyLogo } from "@/components/shared/PitchyLogo";

export default function TermsPage() {
    return (
        <div className="bg-black text-foreground antialiased min-h-screen flex flex-col relative overflow-hidden">
            {/* Decorative Orbs */}
            <div className="aurora-orb top-[-10rem] left-[-5rem] h-96 w-96 bg-white/[0.03] animate-pulse" />
            
            <TopNavBar />

            <main className="flex-grow pt-32 pb-24 px-6 md:px-12 max-w-[1440px] mx-auto w-full relative z-10">
                <div className="max-w-4xl mx-auto">
                    <header className="mb-16 md:mb-24 mt-8 md:mt-16">
                        <h1 className="font-display text-5xl md:text-7xl text-white mb-8 tracking-tighter leading-none">
                            Пользовательское<br/>соглашение<span className="text-white/20">.</span>
                        </h1>
                        <p className="font-body-lg text-xl text-foreground/60 max-w-2xl leading-relaxed">
                            Настоящий документ определяет условия использования сервиса <PitchyLogo size="none" /> и предоставления цифровых услуг.
                        </p>
                    </header>

                    <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="lovable-glass rounded-3xl sm:rounded-[40px] p-5 sm:p-8 md:p-16 shadow-2xl"
                    >
                        <div className="prose prose-invert prose-neutral max-w-none prose-headings:text-white prose-headings:font-display prose-headings:tracking-tight prose-p:text-foreground/70 prose-li:text-foreground/70">
                            <h2 className="text-3xl mb-8 font-display">1. Предмет соглашения</h2>
                            <p>
                                Самозанятый Фигурняк Егор Сергеевич (ИНН: 400700088347) предоставляет Пользователю доступ к сервисам аналитики стартапов и генерации питчей (далее &quot;Сервис&quot;) на условиях подписки.
                            </p>

                            <h2 className="text-3xl mt-12 mb-8 font-display">2. Доступ, оплата и изменение тарифов</h2>
                            <p>
                                Оплата Сервиса осуществляется по безналичному расчету. Доступ к функциям Сервиса предоставляется в цифровом виде автоматически сразу после подтверждения платежа. Возврат средств за неиспользованный период подписки не предусмотрен, за исключением случаев, установленных законодательством РФ.
                            </p>
                            <p>
                                Подписка оформляется с автоматическим продлением (рекуррентными платежами). Оформляя подписку, Пользователь поручает Сервису и платёжному провайдеру (ЮKassa) сохранить способ оплаты и в дату окончания оплаченного периода автоматически списывать стоимость подписки по выбранной конфигурации на следующий период — без дополнительного подтверждения. Списание производится ежемесячно. Пользователь может в любой момент отключить автопродление и отвязать сохранённую карту в личном кабинете (раздел «Способ оплаты»); после этого автоматические списания прекращаются, а доступ сохраняется до конца уже оплаченного периода.
                            </p>
                            <p>
                                Администрация Сервиса оставляет за собой право в любой момент изменять стоимость тарифов, лимиты и состав предоставляемых функций. Обновленные условия публикуются на данной странице и странице Тарифов. Изменение стоимости для уже оплаченных периодов не производится.
                            </p>

                            <h2 className="text-3xl mt-12 mb-8 font-display">3. Ограничения использования</h2>
                            <p>
                                Пользователь обязуется не использовать сервис для массовой автоматической генерации запросов, нарушающих Политику добросовестного использования, а также не пытаться получить несанкционированный доступ к технической инфраструктуре Сервиса.
                            </p>

                            <h2 className="text-3xl mt-12 mb-8 font-display">4. Политика добросовестного использования</h2>
                            <p>
                                &quot;Безлимитный&quot; доступ на тарифах предоставляется для целей добросовестного использования. Нарушением Политики добросовестного использования считаются:
                            </p>
                            <ul>
                                <li>Использование автоматизированных скриптов, ботов или парсеров для массовой генерации запросов в обход официального интерфейса.</li>
                                <li>Передача (шеринг) одного аккаунта посторонним лицам для обхода ограничений подписки.</li>
                                <li>Генерация аномально высокой нагрузки (непропорционально превышающей среднюю активность в десятки раз), которая может навредить работоспособности серверов.</li>
                            </ul>

                            <h2 className="text-3xl mt-12 mb-8 font-display">5. Отказ от гарантий</h2>
                            <p>
                                Сервис предоставляется на условиях «как есть». Администрация не гарантирует, что Сервис будет соответствовать вашим требованиям.
                            </p>
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mt-8">
                                <p className="mb-0">
                                    <strong className="text-white">Важно:</strong> Результаты аналитики, скоринг и сгенерированные питч-деки предоставляются исключительно в информационных целях. Сервис <strong className="text-white">не является инвестиционной рекомендацией</strong>. Пользователь принимает на себя всю ответственность за любые бизнес-решения.
                                </p>
                            </div>

                            <h2 className="text-3xl mt-12 mb-8 font-display">6. Интеллектуальная собственность</h2>
                            <p>
                                Все права на исходный код сервиса, дизайн и методологию принадлежат Администрации. Права на выходные данные (сгенерированные тексты анализов, PDF-отчеты) полностью передаются Пользователю.
                            </p>

                            <h2 className="text-3xl mt-12 mb-8 font-display">7. Контактная информация</h2>
                            <p>
                                В случае возникновения вопросов, Пользователь может обратиться в службу поддержки по электронной почте <strong className="text-white">auth@pitchy.pro</strong> или в Telegram <strong className="text-white">@homeboyjimmy</strong>.
                            </p>

                            <div className="mt-16 pt-8 border-t border-white/10">
                                <p className="font-sans text-[11px] text-white/30 uppercase tracking-widest italic">
                                    Дата последнего обновления: 20 февраля 2026 года.
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
