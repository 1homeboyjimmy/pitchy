import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="bg-[#0A0A0A] border-t border-white/[0.08] pt-24 pb-12">
      <div className="max-w-[1440px] mx-auto px-4 md:px-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-20">
          <div className="space-y-6">
            <h4 className="text-white font-bold text-sm uppercase tracking-wider">Продукт</h4>
            <ul className="space-y-4">
              <li><Link className="text-neutral-500 hover:text-white transition-colors text-sm" href="/">Главная</Link></li>
              <li><Link className="text-neutral-500 hover:text-white transition-colors text-sm" href="/pricing">Тарифы</Link></li>
              <li><Link className="text-neutral-500 hover:text-white transition-colors text-sm" href="/faq">FAQ</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white font-bold text-sm uppercase tracking-wider">Компания</h4>
            <ul className="space-y-4">
              <li><Link className="text-neutral-500 hover:text-white transition-colors text-sm" href="/about">О нас</Link></li>
              <li><Link className="text-neutral-500 hover:text-white transition-colors text-sm" href="/contacts">Контакты</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white font-bold text-sm uppercase tracking-wider">Ресурсы</h4>
            <ul className="space-y-4">
              <li><Link className="text-neutral-500 hover:text-white transition-colors text-sm" href="/dashboard">Дашборд</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white font-bold text-sm uppercase tracking-wider">Правовая информация</h4>
            <ul className="space-y-4">
              <li><Link className="text-neutral-500 hover:text-white transition-colors text-sm" href="/privacy">Конфиденциальность</Link></li>
              <li><Link className="text-neutral-500 hover:text-white transition-colors text-sm" href="/terms">Условия</Link></li>
              <li><Link className="text-neutral-500 hover:text-white transition-colors text-sm" href="#">Безопасность</Link></li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
