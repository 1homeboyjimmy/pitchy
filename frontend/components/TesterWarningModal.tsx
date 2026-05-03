import { motion } from "framer-motion";
import { X, Lock, ExternalLink } from "react-feather";
import Link from "next/link";

interface TesterWarningModalProps {
    isOpen: boolean;
    onClose: () => void;
    featureName?: string;
}

export default function TesterWarningModal({ isOpen, onClose, featureName }: TesterWarningModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-pitchy-bg/80 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-pitchy-card border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl relative"
            >
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
                >
                    <X className="w-6 h-6" />
                </button>

                <div className="p-8 pb-6 text-center">
                    <div className="mx-auto bg-white/10 w-16 h-16 rounded-full flex items-center justify-center mb-6">
                        <Lock className="w-8 h-8 text-white" />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-2">
                        Ограничение тарифа Tester
                    </h3>
                    <p className="text-white/70 mb-6 leading-relaxed">
                        Функция {featureName ? <strong className="text-white">«{featureName}»</strong> : "которую вы выбрали"} недоступна в демо-тарифе.
                        Пожалуйста, оформите полноценную подписку для снятия ограничений.
                    </p>
                </div>

                <div className="px-8 pb-8 flex flex-col gap-3">
                    <Link
                        href="/pricing"
                        onClick={onClose}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white text-black font-medium transition-colors"
                    >
                        Посмотреть тарифы
                        <ExternalLink className="w-4 h-4" />
                    </Link>
                    <button
                        onClick={onClose}
                        className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium transition-colors border border-white/10"
                    >
                        Понятно, закрыть
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
