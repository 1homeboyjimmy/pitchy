"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Zap, Check, ArrowRight, AlertCircle } from "react-feather";
import { useRouter } from "next/navigation";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  message?: string;
}

export function UpgradeModal({ isOpen, onClose, message }: UpgradeModalProps) {
  const router = useRouter();

  const features = [
    "Улучшенная модель Pitchy",
    "До 100 запросов в месяц",
    "Продвинутый CustDev-анализ",
    "Глубокий поиск по рынку",
  ];

  // Must match the live values in DB.promocodes for STARTER30 — the modal
  // promises this discount, so changing one without the other lies to users.
  // promocodes.STARTER30: discount_percent=34, target_tier=starter
  // billing.PRICING_PLANS.starter.monthly = 2490
  const originalPrice = 2490;
  const discount = 34;
  const discountedPrice = Math.round(originalPrice * (1 - discount / 100));

  const handleUpgrade = () => {
    onClose();
    router.push("/pricing");
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          onClick={onClose}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-3xl overflow-hidden"
          >
            {/* Gradient border effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-pitchy-violet via-purple-600 to-pitchy-cyan p-[1px] rounded-3xl">
              <div className="absolute inset-[1px] bg-[#1a1a2e] rounded-3xl" />
            </div>

            {/* Content */}
            <div className="relative z-10 p-6 sm:p-8">
              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Icon */}
              <div className="flex justify-center mb-5">
                <motion.div
                  initial={{ rotate: -10 }}
                  animate={{ rotate: [0, -5, 5, 0] }}
                  transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                  className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center"
                >
                  <AlertCircle className="w-8 h-8 text-amber-400" />
                </motion.div>
              </div>

              {/* Title */}
              <h2 className="text-xl sm:text-2xl font-bold text-white text-center mb-2">
                Лимит сообщений исчерпан
              </h2>
              <p className="text-white/50 text-sm text-center mb-6 leading-relaxed">
                {message || "Вы использовали все доступные сообщения на тарифе Tester."}
                {" "}Оформите подписку, чтобы продолжить работу с Pitchy.
              </p>

              {/* Discount badge */}
              <div className="flex justify-center mb-5">
                <div
                  className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-emerald-500/20 to-green-500/20 border border-emerald-500/30"
                >
                  <Zap className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400 text-sm font-bold">
                    Скидка {discount}% для вас по промокоду STARTER30
                  </span>
                </div>
              </div>

              {/* Price block */}
              <div className="bg-white/5 rounded-2xl border border-white/10 p-5 mb-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">Starter</h3>
                    <p className="text-xs text-white/40">Для соло-фаундеров и ангелов</p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm text-white/40 line-through mr-2">
                      ₽{originalPrice.toLocaleString("ru-RU")}
                    </span>
                    <span className="text-2xl font-bold text-white">
                      ₽{discountedPrice.toLocaleString("ru-RU")}
                    </span>
                    <span className="text-white/40 text-sm">/мес</span>
                  </div>
                </div>

                <ul className="space-y-2.5">
                  {features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-2 text-sm text-white/70"
                    >
                      <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              {/* CTA */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleUpgrade}
                className="w-full py-3.5 rounded-xl font-bold text-white text-base bg-gradient-to-r from-pitchy-violet to-pitchy-cyan hover:shadow-[0_0_30px_rgba(168,85,247,0.4)] transition-shadow flex items-center justify-center gap-2"
              >
                Перейти к тарифам
                <ArrowRight className="w-5 h-5" />
              </motion.button>

              <button
                onClick={onClose}
                className="w-full mt-3 py-2.5 text-sm text-white/40 hover:text-white/60 transition-colors"
              >
                Не сейчас
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
