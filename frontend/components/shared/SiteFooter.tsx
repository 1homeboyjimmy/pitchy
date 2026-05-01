import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="bg-[#0A0A0A] border-t border-white/[0.08] pt-24 pb-24 mt-auto">
      <div className="max-w-[1440px] mx-auto px-4 md:px-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-12">
          <div className="space-y-6">
            <h4 className="text-white font-mono-label font-bold text-[13px] uppercase tracking-wider mb-6">Продукт</h4>
            <ul className="space-y-4">
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/">Главная</Link></li>
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/pricing">Тарифы</Link></li>
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/faq">FAQ</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white font-mono-label font-bold text-[13px] uppercase tracking-wider mb-6">Компания</h4>
            <ul className="space-y-4">
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/about">О нас</Link></li>
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/contact">Контакты</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white font-mono-label font-bold text-[13px] uppercase tracking-wider mb-6">Ресурсы</h4>
            <ul className="space-y-4">
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/dashboard">Дашборд</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white font-mono-label font-bold text-[13px] uppercase tracking-wider mb-6">Правовая информация</h4>
            <ul className="space-y-4">
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/privacy">Конфиденциальность</Link></li>
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/terms">Условия</Link></li>
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/security">Безопасность</Link></li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
