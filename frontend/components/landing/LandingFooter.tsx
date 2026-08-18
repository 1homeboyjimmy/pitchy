"use client";

import Link from "next/link";
import { PitchyLogo } from "../shared/PitchyLogo";

export function LandingFooter() {
  return (
    <footer className="relative bg-black pt-24 pb-12 overflow-hidden section-line">
      {/* Decorative Aurora Orb for Footer */}
      <div className="aurora-orb left-[-10rem] bottom-[-5rem] h-64 w-64 bg-white/[0.02] animate-float-slow" />
      <div className="max-w-7xl mx-auto px-6 md:px-12 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-12">
          <div className="space-y-6">
            <h4 className="text-white text-sm font-medium uppercase tracking-tighter font-sans">Продукт</h4>
            <ul className="space-y-3">
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors font-sans font-medium tracking-tight whitespace-nowrap" href="/">Главная</Link></li>
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors font-sans font-medium tracking-tight whitespace-nowrap" href="/pricing">Тарифы</Link></li>
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors font-sans font-medium tracking-tight whitespace-nowrap" href="/faq">FAQ</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white text-sm font-medium uppercase tracking-tighter font-sans">Компания</h4>
            <ul className="space-y-3">
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors font-sans font-medium tracking-tight whitespace-nowrap" href="/about">О нас</Link></li>
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors font-sans font-medium tracking-tight whitespace-nowrap" href="/contact">Контакты</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white text-sm font-medium uppercase tracking-tighter font-sans">Ресурсы</h4>
            <ul className="space-y-3">
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors font-sans font-medium tracking-tight whitespace-nowrap" href="/dashboard">Дашборд</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white text-sm font-medium uppercase tracking-tighter font-sans">Правовая информация</h4>
            <ul className="space-y-3">
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors font-sans font-medium tracking-tight whitespace-nowrap" href="/privacy">Конфиденциальность</Link></li>
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors font-sans font-medium tracking-tight whitespace-nowrap" href="/terms">Условия</Link></li>
              <li><Link className="text-sm text-white/50 hover:text-white transition-colors font-sans font-medium tracking-tight whitespace-nowrap" href="/security">Безопасность</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-24 pt-8 border-t border-white/5">
          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div className="flex items-baseline gap-3">
              <PitchyLogo size="3xl" />
              <span className="text-white/50 text-xs font-medium font-sans tracking-tight uppercase">
                © 2026 Все права защищены
              </span>
            </div>
            <p className="text-white/50 text-xs font-medium font-sans tracking-widest uppercase">
              НПД Фигурняк Егор Сергеевич, ИНН 400700088347
            </p>
            <a
              href="https://productradar.ru/product/pitchy-pro?utm_source=badge"
              target="_blank"
              rel="noopener noreferrer"
              className="self-start opacity-80 transition-opacity hover:opacity-100 md:self-end"
              aria-label="Pitchy — продукт недели номер 1 на Product Radar"
            >
              <img
                src="https://productradar.ru/wp-json/productradar/v1/badge?period=week&rank=1&theme=black"
                alt="Награда Product Radar: продукт недели №1"
                width={252}
                height={68}
                className="h-auto w-[210px] sm:w-[252px]"
              />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
