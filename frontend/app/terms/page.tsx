import Layout from "@/components/Layout";

export default function TermsPage() {
    return (
        <Layout>
            <div className="min-h-screen pt-24 pb-16 px-4 flex justify-center">
                <div className="max-w-4xl w-full text-white prose prose-invert">
                    <h1 className="text-3xl font-bold mb-8">Пользовательское соглашение и Оферта</h1>
                    <p className="text-white/70 mb-4">
                        Настоящий документ определяет условия использования сервиса Pitchy.pro и предоставления цифровых услуг.
                    </p>

                    <h2 className="text-2xl font-semibold mt-8 mb-4">1. Предмет соглашения</h2>
                    <p className="text-white/70 mb-4">
                        ИП / Самозанятый Фигурняк Егор Сергеевич (ИНН: 400700088347) предоставляет Пользователю доступ к сервисам аналитики стартапов и генерации питчей (далее "Сервис") на условиях подписки.
                    </p>

                    <h2 className="text-2xl font-semibold mt-8 mb-4">2. Доступ и оплата</h2>
                    <p className="text-white/70 mb-4">
                        Оплата Сервиса осуществляется по безналичному расчету. Доступ к функциям Сервиса предоставляется в цифровом виде автоматически сразу после подтверждения платежа. Возврат средств за неиспользованный период подписки не предусмотрен, за исключением случаев, установленных законодательством РФ.
                    </p>

                    <h2 className="text-2xl font-semibold mt-8 mb-4">3. Ограничения использования</h2>
                    <p className="text-white/70 mb-4">
                        Пользователь обязуется не использовать сервис для массовой автоматической генерации запросов, нарушающих Fair Use Policy, а также не пытаться получить несанкционированный доступ к технической инфраструктуре Сервиса.
                    </p>

                    <h2 className="text-2xl font-semibold mt-8 mb-4">4. Контактная информация</h2>
                    <p className="text-white/70 mb-4">
                        В случае возникновения вопросов, Пользователь может обратиться в службу поддержки по электронной почте <strong>hello@pitchy.pro</strong> или в Telegram <strong>@homeboyjimmy1</strong>.
                    </p>

                    <p className="text-white/40 mt-12 text-sm border-t border-white/10 pt-4">
                        Дата последнего обновления: 20 февраля 2026 года.
                    </p>
                </div>
            </div>
        </Layout>
    );
}
