import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";

export default function CookiesPage() {
    return (
        <div className="bg-background text-on-background antialiased min-h-screen flex flex-col">
            <TopNavBar />
            <main className="flex-grow pt-24 pb-16 px-6 md:px-12 max-w-[1440px] mx-auto w-full">
                <header className="mb-12 mt-8 md:mt-16">
                    <div className="inline-block bg-white/5 border border-white/[0.08] rounded px-3 py-1 mb-6">
                        <span className="font-mono-label text-[11px] text-neutral-400 uppercase tracking-widest">PITCHY.PRO / LEGAL</span>
                    </div>
                    <h1 className="font-display text-[40px] leading-none tracking-tight text-primary mb-6 max-w-3xl">Политика файлов Cookie</h1>
                </header>
                <div className="max-w-3xl text-neutral-300 prose prose-invert prose-neutral prose-headings:text-white">

                    <h2 className="text-2xl font-semibold mt-8 mb-4">1. Общие положения</h2>
                    <p className="text-white/70 mb-4">
                        Условия настоящей Политики использования файлов cookie (далее &quot;Политика&quot;) распространяются на сервис Pitchy.pro (далее &quot;Сайт&quot;).
                    </p>
                    <p className="text-white/70 mb-4">
                        Целью настоящей Политики является проинформировать Пользователя о перечне используемых Файлов cookie, целях их установки, сроках хранения, а также способах отключения и/или удаления с устройства. Сведения, указанные в настоящем документе, являются неотъемлемой частью Политики конфиденциальности.
                    </p>
                    <p className="text-white/70 mb-4">
                        Правообладатель Сайта: Самозанятый Фигурняк Егор Сергеевич, ИНН 400700088347. Контактный адрес для вопросов: <strong>auth@pitchy.pro</strong>.
                    </p>

                    <h2 className="text-2xl font-semibold mt-8 mb-4">2. Определение понятий</h2>
                    <p className="text-white/70 mb-4">
                        <strong>&quot;Файлы cookie&quot;</strong> — небольшие фрагменты данных, хранящиеся на устройстве Пользователя (компьютере, планшете, телефоне). Они позволяют распознавать браузер и записывать определенную информацию при посещении Сайта с целью авторизации и улучшения пользовательского опыта.
                    </p>
                    <p className="text-white/70 mb-4">
                        <strong>&quot;Пользователь&quot;</strong> — лицо, использующее Сайт.
                    </p>

                    <h2 className="text-2xl font-semibold mt-8 mb-4">3. Для чего используются Файлы cookie?</h2>
                    <p className="text-white/70 mb-4">
                        Мы используем Файлы cookie для следующих целей:
                    </p>
                    <ul className="list-disc pl-5 text-white/70 mb-4 space-y-2">
                        <li>Для <strong>безопасной авторизации</strong>: распознавания пользователя при входе на Сайт и сохранения сессии (чтобы не приходилось вводить пароль при каждом обновлении страницы).</li>
                        <li>Для работы ключевых разделов Сайта, где использование cookie критически необходимо (личный кабинет, история анализов).</li>
                        <li>Для аналитики посещаемости и поведения с помощью Яндекс.Метрики и Вебвизора — только после отдельного согласия Пользователя.</li>
                    </ul>
                    <p className="text-white/70 mb-4">
                        Через Файлы cookie мы <strong>не идентифицируем</strong> личность Пользователя напрямую (если это не связано с его авторизованным аккаунтом).
                    </p>

                    <h2 className="text-2xl font-semibold mt-8 mb-4">4. Какие Файлы cookie мы используем?</h2>
                    <p className="text-white/70 mb-4">
                        <strong>1. Технические (строго необходимые) cookie-файлы.</strong><br />
                        Они необходимы для бесперебойной работы Сайта. Сюда входят токены авторизации (JWT), передаваемые через безопасные HttpOnly файлы cookie. <strong>Отключение данного типа приведет к невозможности входа в систему и использования платных функций платформы.</strong>
                    </p>
                    <p className="text-white/70 mb-4">
                        <strong>2. Статистические и аналитические cookie-файлы.</strong><br />
                        Используются для оценки посещаемости, пользовательских сценариев и выявления ошибок с помощью Яндекс.Метрики и Вебвизора. Они не загружаются до согласия Пользователя. Отказ от этой категории не ограничивает основные функции Сайта.
                    </p>

                    <h2 className="text-2xl font-semibold mt-8 mb-4">5. Управление согласием</h2>
                    <p className="text-white/70 mb-4">
                        При первом посещении Сайт предлагает принять аналитические cookie или оставить только необходимые. Выбор сохраняется в браузере. Для авторизованных Пользователей он также синхронизируется с профилем.
                    </p>
                    <p className="text-white/70 mb-4">
                        Изменить решение можно в любое время кнопкой <strong>«Настройки cookie»</strong> в нижней части страницы. При отзыве согласия аналитика прекращается, а доступные Сайту cookie Яндекс.Метрики удаляются. Уже переданные до отзыва сведения обрабатываются в соответствии с условиями сервиса аналитики и законодательством.
                    </p>

                    <h2 className="text-2xl font-semibold mt-8 mb-4">6. Настройки браузера</h2>
                    <p className="text-white/70 mb-4">
                        Каждый Пользователь может в любой момент отключить работу Файлов cookie или удалить уже загруженные файлы путем изменения настроек своего браузера.
                    </p>
                    <p className="text-white/70 mb-4">
                        Обратите внимание: блокировка <strong>технических</strong> файлов cookie сделает невозможной авторизацию на сайте Pitchy.pro.
                    </p>
                    <p className="text-white/70 mb-4">
                        Инструкции для популярных браузеров:
                    </p>
                    <ul className="list-disc pl-5 text-white/70 mb-4 space-y-2">
                        <li><strong>Google Chrome:</strong> Настройки {'>'} Конфиденциальность и безопасность {'>'} Файлы cookie.</li>
                        <li><strong>Safari:</strong> Настройки {'>'} Конфиденциальность {'>'} Управление данными веб-сайтов.</li>
                        <li><strong>Firefox:</strong> Настройки {'>'} Приватность и защита {'>'} Куки и данные сайтов.</li>
                        <li><strong>Яндекс.Браузер:</strong> Настройки {'>'} Сайты {'>'} Расширенные настройки сайтов {'>'} Cookie-файлы.</li>
                    </ul>

                    <p className="text-white/40 mt-12 text-sm border-t border-white/10 pt-4">
                        Дата последнего обновления: 8 августа 2026 года.
                    </p>
                </div>
            </main>
            <SiteFooter />
        </div>
    );
}
