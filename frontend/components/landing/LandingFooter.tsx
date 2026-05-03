import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="relative bg-black pt-24 pb-12 overflow-hidden section-line">
      {/* Decorative Aurora Orb for Footer */}
      <div className="aurora-orb left-[-10rem] bottom-[-5rem] h-64 w-64 bg-[oklch(0.35_0.12_280_/_0.15)] animate-float-slow" />
      
      <div className="max-w-7xl mx-auto px-6 md:px-12 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-12">
          <div className="space-y-6">
            <h4 className="text-white text-sm font-bold uppercase tracking-widest">Продукт</h4>
            <ul className="space-y-3">
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors" href="/">Главная</Link></li>
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors" href="/pricing">Тарифы</Link></li>
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors" href="/faq">FAQ</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white text-sm font-bold uppercase tracking-widest">Компания</h4>
            <ul className="space-y-3">
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors" href="/about">О нас</Link></li>
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors" href="/contact">Контакты</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white text-sm font-bold uppercase tracking-widest">Ресурсы</h4>
            <ul className="space-y-3">
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors" href="/dashboard">Дашборд</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white text-sm font-bold uppercase tracking-widest">Юридические данные</h4>
            <ul className="space-y-3">
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors" href="/privacy">Конфиденциальность</Link></li>
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors" href="/terms">Условия</Link></li>
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors" href="/security">Безопасность</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-24 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-white font-medium text-xl tracking-tighter" style={{ fontFamily: "'Instrument Serif', serif" }}>
                Pitchy
                <span className="text-white/40 font-light italic ml-1">.pro</span>
            </span>
          </div>
          <p className="text-white/30 text-xs font-light">
            © 2024 Pitchy.pro. Все права защищены.
          </p>
        </div>
      </div>
    </footer>
  );
}
